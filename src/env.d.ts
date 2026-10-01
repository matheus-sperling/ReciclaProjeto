/// <reference types="vite/client" />
declare module "qrious" {
  export default class QRious {
    constructor(options: {
      element: HTMLCanvasElement;
      value: string;
      size: number;
      padding?: number;
      level?: string;
    });
  }
}
