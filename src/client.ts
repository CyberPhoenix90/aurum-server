import { CancellationToken } from "aurumjs";
import * as ws from "ws";
import { ServerProtocol } from "./protocol";

export class Client {
    public readonly subscriptions: Map<string, CancellationToken>;
    public readonly connection: ws;
    public timeSinceLastMessage: number;

    constructor(connection: ws) {
        this.connection = connection;
        this.subscriptions = new Map();
    }

    public sendMessage(messageType: ServerProtocol, payload: any) {
        this.connection.send(JSON.stringify({ type: messageType, ...payload }));
    }
}
