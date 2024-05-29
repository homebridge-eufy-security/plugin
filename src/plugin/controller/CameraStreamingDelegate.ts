import { StreamingDelegate } from "./streamingDelegate";
import { CameraController } from "homebridge";
import { HAP } from "../utils/utils";
import { CameraAccessory } from "../accessories/CameraAccessory";

export class CameraStreamingDelegate extends StreamingDelegate<CameraController> {

  constructor(camera: CameraAccessory) {
    super(camera);
    this.controller = new HAP.CameraController(this.options);
  }

  public getController(): CameraController {
    return this.controller;
  }
}