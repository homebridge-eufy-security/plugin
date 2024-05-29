import { StreamingDelegate } from "./streamingDelegate";
import { DoorbellController } from "homebridge";
import { HAP } from "../utils/utils";
import { DoorbellAccessory } from "../accessories/DoorbellAccessory";

export class DoorbellStreamingDelegate extends StreamingDelegate<DoorbellController> {

  constructor(camera: DoorbellAccessory) {
    super(camera);
    this.controller = new HAP.DoorbellController(this.options);
  }

  public getController(): DoorbellController {
    return this.controller;
  }
}