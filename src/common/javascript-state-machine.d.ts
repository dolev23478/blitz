// Minimal v3 API. The community @types package describes the incompatible v2 API.
declare module 'javascript-state-machine' {
  export default class StateMachine {
    constructor(config: {
      init: string;
      transitions: { name: string; from: string; to: string }[];
    });
    readonly state: string;
    success(): void;
    fail(): void;
  }
}
