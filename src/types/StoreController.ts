import { Unsubscriber, Writable } from "svelte/store";

export abstract class StoreController<T> {
    protected unsubscribe: Unsubscriber;
    protected store: Writable<T>;

    constructor(store: Writable<T>) {
        this.store = store;
    }

    public on(): StoreController<T> {
        this.unsubscribe = this.store.subscribe(this.onChange.bind(this));
        return this;
    }

    public off(): StoreController<T> {
        this.unsubscribe();
        return this;
    }

    protected abstract onChange(value: T): void;
}
