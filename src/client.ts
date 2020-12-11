import { CancellationToken, RemoteProtocol } from "aurumjs";
import * as ws from "ws";

export class Client {
    public readonly subscriptions: Map<string, CancellationToken>;
    public readonly connection: ws;
    public timeSinceLastMessage: number;

    constructor(connection: ws) {
        this.connection = connection;
        this.subscriptions = new Map();
    }

    public sendMessage(messageType: RemoteProtocol, payload: any) {
        this.connection.send(JSON.stringify({ type: messageType, ...payload }));
    }
}
