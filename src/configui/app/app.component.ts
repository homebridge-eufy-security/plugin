import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
    selector: 'app-root',
    templateUrl: './app.component.html',
    standalone: true,
    imports: [RouterOutlet],
})
export class AppComponent {
  title = 'config-ui';
  logoSrc = 'assets/images/homebridge-eufy-security.png';
}
