/* eslint-disable no-console */
import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';

import { Credentials, LoginResult, LoginFailReason } from '../util/types';
import { LoginService } from '../login.service';

import { Country, COUNTRIES } from '../countries';

enum LoginStep {
  LOGIN = 1,
  TFA = 2,
  CAPTCHA = 3,
}

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
})
export class LoginComponent implements OnInit {
  countries: Country[] = [];

  credentials: Credentials = {
    username: '',
    password: '',
    country: 'US',
    deviceName: '',
  };

  otp = '';

  captcha = '';
  captchaImageData = '';
  captchaId = '';

  loginInProgress = false;
  loginFailed = false;
  loginStep = LoginStep.LOGIN;

  firstLoginAssumed = false;

  emailIsValid = true;
  passwordIsValid = true;
  otpIsValid = true;
  captchaIsValid = true;

  constructor(private loginService: LoginService, private routerService: Router) {}

  ngOnInit(): void {
    this.getCredentials();
    this.fillCountryArray();
  }

  private getCredentials() {
    this.loginService
      .getCredentials()
      .then((creds) => (this.credentials = creds))
      .catch((err) => {
        this.firstLoginAssumed = true;
        console.log('Could not get config in login component: ' + err);
      });
  }

  private fillCountryArray() {
    Object.entries(COUNTRIES).forEach(([key, value]) => {
      this.countries.push({
        short: key,
        long: value,
      });
    });
  }

  login() {
    if (this.inputIsInvalid()) {
      return;
    }

    this.resetLoginFailed();
    this.loginInProgress = true;

    if (this.loginStep === LoginStep.LOGIN) {
      this.loginWithCredentials();
    }
    if (this.loginStep === LoginStep.TFA) {
      this.loginWithTFA();
    }
    if (this.loginStep === LoginStep.CAPTCHA) {
      this.loginWithCaptcha();
    }
  }

  private async loginWithCredentials() {
    let loginResult: LoginResult | undefined = undefined;
    try {
      loginResult = await this.loginService.login(this.credentials);
    } catch (err) {
      console.log('login error: ' + err);
    }

    this.evaluateLoginResult(loginResult);
  }

  private async loginWithTFA() {
    let loginResult: LoginResult | undefined = undefined;
    try {
      loginResult = await this.loginService.login({ verifyCode: this.otp });
    } catch (err) {
      console.log('login error: ' + err);
    }

    this.evaluateLoginResult(loginResult);
  }

  private async loginWithCaptcha() {
    let loginResult: LoginResult | undefined = undefined;
    try {
      loginResult = await this.loginService.login({
        captcha: {
          captchaCode: this.captcha,
          captchaId: this.captchaId,
        },
      });
    } catch (err) {
      console.log('login error: ' + err);
    }

    this.evaluateLoginResult(loginResult);
  }

  private evaluateLoginResult(loginResult: LoginResult | undefined) {
    this.loginInProgress = false;

    if (loginResult && loginResult.success) {
      this.loginService.updateConfigCredentials(this.credentials);
      this.routerService.navigate(['/accessories', { waitForAccessories: true }]);
    } else {
      if (loginResult && loginResult.failReason && loginResult.failReason === LoginFailReason.TFA) {
        this.loginStep = LoginStep.TFA;
        return;
      }

      if (
        loginResult &&
        loginResult.failReason &&
        loginResult.failReason === LoginFailReason.CAPTCHA &&
        loginResult.data &&
        loginResult.data.id &&
        loginResult.data.captcha
      ) {
        this.loginStep = LoginStep.CAPTCHA;
        this.captchaId = loginResult.data.id;
        this.captchaImageData = loginResult.data.captcha;
        return;
      }

      this.loginStep = LoginStep.LOGIN;
      this.loginFailed = true;
    }
  }

  private inputIsInvalid(): boolean {
    this.emailIsValid = true;
    this.passwordIsValid = true;
    this.otpIsValid = true;

    let inputError = false;

    if (this.loginStep === LoginStep.LOGIN && this.credentials.username.length < 4) {
      this.emailIsValid = false;
      inputError = true;
    }
    if (this.loginStep === LoginStep.LOGIN && this.credentials.password.length < 4) {
      this.passwordIsValid = false;
      inputError = true;
    }

    if (this.loginStep === LoginStep.TFA && this.otp.length < 6) {
      this.otpIsValid = false;
      inputError = true;
    }

    if (this.loginStep === LoginStep.CAPTCHA && this.captcha.length < 4) {
      this.captchaIsValid = false;
      inputError = true;
    }

    return inputError;
  }

  resetLoginFailed() {
    this.loginFailed = false;
  }

  cancelLogin() {
    this.routerService.navigate(['/accessories']);
  }
}
