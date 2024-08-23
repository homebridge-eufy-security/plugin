import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';

import { Credentials, LoginResult, LoginFailReason, Country } from '../util/types';
import { LoginService } from '../login.service';

import { COUNTRIES } from '../countries';
import { FormsModule } from '@angular/forms';
import { NgbAlert, NgbPopover, NgbTooltip } from '@ng-bootstrap/ng-bootstrap';
import { NgIf, NgFor } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';

enum LoginStep {
  START = 0,
  LOGIN = 1,
  TFA = 2,
  CAPTCHA = 3,
}

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  standalone: true,
  imports: [
    NgIf,
    NgbAlert,
    NgbPopover,
    FormsModule,
    NgbTooltip,
    NgFor,
    LucideAngularModule,
  ],
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
  loginStep = LoginStep.START;

  firstLoginAssumed = false;

  nodeJSIncompatible: boolean = true;
  nodeJSversion: string = '1.1.1';

  emailIsValid = true;
  passwordIsValid = true;
  otpIsValid = true;
  captchaIsValid = true;

  constructor(private loginService: LoginService, private routerService: Router) { }

  async ngOnInit(): Promise<void> {
    const r = await window.homebridge.request('/nodeJSVersion');
    this.nodeJSversion = r.nodeJSversion;
    this.nodeJSIncompatible = r.nodeJSIncompatible;

    console.log('r: ', r);

    this.getCredentials();
    this.fillCountryArray();
  }

  private async getCredentials() {
    try {
      this.credentials = this.loginService.getCredentials();
    } catch (error) {
      this.firstLoginAssumed = true;
      console.log(error);
    }
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
    } catch (error) {
      console.log('login error: ' + error);
    }

    this.evaluateLoginResult(loginResult);
  }

  private async loginWithTFA() {
    let loginResult: LoginResult | undefined = undefined;
    try {
      loginResult = await this.loginService.login({ verifyCode: this.otp });
    } catch (error) {
      console.log('login error: ' + error);
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
    } catch (error) {
      console.log('login error: ' + error);
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
