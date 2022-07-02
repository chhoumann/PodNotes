import { EventEmitter } from "events";

export enum PlayerEvents {
    START_PLAYING="start",
    STOP_PLAYING="stop",

}

export interface IPlayer {
    /** Add event listener. */
    on: (event: PlayerEvents, callback: () => void) => void;
    /** Remove event listener. */
    off: (event: PlayerEvents, callback: () => void) => void;
    start: () => void;
    stop: () => void;
    /** Returns true if the player is playing and false if it is not. */
    isPlaying: boolean;
}

/**
 * Singleton START/STOP event emitter.
 */
export class Player extends EventEmitter implements IPlayer {
    private _isPlaying = false;
    private static _instance: Player;
    private constructor() { super(); }

    public static get Instance(): IPlayer {
        return this._instance || (this._instance = new this());
    }

    public get isPlaying(): boolean {
        return this._isPlaying;
    }
    
    on(event: PlayerEvents, listener: () => void): this {
        super.on(event, listener);
        return this;
    }

    off(event: PlayerEvents, listener: () => void): this {
        super.off(event, listener);
        return this;
    }

    start(): void {
        this._isPlaying = true;
        this.emit(PlayerEvents.START_PLAYING);
    }

    stop(): void {
        this._isPlaying = false;
        this.emit(PlayerEvents.STOP_PLAYING);
    }
}