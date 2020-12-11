import {
    ArrayDataSource,
    CancellationToken,
    DataSource,
    RemoteProtocol,
} from "aurumjs";
import { Server as HttpServer } from "http";
import { Server as HttpsServer } from "https";
import * as ws from "ws";
import { Client } from "./client";

export interface AurumServerConfig {
    reuseServer?: HttpServer | HttpsServer;
    port?: number;
    maxMessageSize?: number;
    onClientConnected?: (client: Client) => void;
    onClientDisconnected?: (client: Client) => void;
}

export class AurumServer {
    private wsServer: ws.Server;
    private wsServerClients: Client[];
    private config: AurumServerConfig;

    private exposedDataSources: Map<
        string,
        {
            source: DataSource<any>;
            authenticator(token: string, operation: "read" | "write"): boolean;
        }
    >;
    private exposedArrayDataSources: Map<
        string,
        {
            source: ArrayDataSource<any>;
            authenticator(
                token: string,
                operation:
                    | "read"
                    | "replace"
                    | "append"
                    | "prepend"
                    | "removeRight"
                    | "removeLeft"
                    | "remove"
                    | "swap"
                    | "clear"
                    | "merge"
                    | "insert"
            ): boolean;
        }
    >;

    private constructor(config: AurumServerConfig) {
        this.config = config;

        this.exposedDataSources = new Map();
        this.exposedArrayDataSources = new Map();
    }

    public getClients(): ReadonlyArray<Client> {
        return this.wsServerClients;
    }

    public static create(config?: AurumServerConfig): AurumServer {
        const server = new AurumServer({
            onClientConnected: config.onClientConnected,
            onClientDisconnected: config.onClientDisconnected,
            reuseServer: config.reuseServer,
            maxMessageSize: config?.maxMessageSize || 1048576,
            port: config?.port ?? 8080,
        });

        server.wsServer = new ws.Server({
            server: config.reuseServer,
            port: config.port,
        });

        server.wsServerClients = [];

        server.wsServer.on("connection", (ws: ws) => {
            const client = new Client(ws);
            server.wsServerClients.push(client);
            console.log(
                //@ts-ignore
                `Client connected ${ws._socket.remoteAddress}:${ws._socket.remotePort}`
            );

            ws.on("message", (data) => {
                server.processMessage(client, data);
            });

            ws.on("close", () => {
                console.log(
                    //@ts-ignore
                    `Client disconnected ${ws._socket.remoteAddress}:${ws._socket.remotePort}`
                );
                server.wsServerClients.splice(
                    server.wsServerClients.indexOf(client),
                    1
                );
                config.onClientDisconnected?.(client);
            });
            config.onClientConnected?.(client);
        });

        return server;
    }

    private processMessage(sender: Client, data: ws.Data): void {
        if (typeof data === "string") {
            if (data.length >= this.config.maxMessageSize) {
                console.error(
                    `Received message with size ${data.length} max allowed is ${this.config.maxMessageSize}`
                );
                return;
            }

            try {
                const message = JSON.parse(data);
                const type: RemoteProtocol = message.type;
                sender.timeSinceLastMessage = Date.now();
                switch (type) {
                    case RemoteProtocol.LISTEN_DATASOURCE:
                        this.listenDataSource(message, sender);
                        break;
                    case RemoteProtocol.HEARTBEAT:
                        break;
                }
            } catch (e) {
                console.error("Failed to parse message");
                console.error(e);
            }
        }
    }

    private listenDataSource(message: any, sender: Client) {
        const id = message.id;
        if (this.exposedDataSources.has(id)) {
            const endpoint = this.exposedDataSources.get(id);
            const token = new CancellationToken();
            sender.subscriptions.set(id, token);
            endpoint.source.listen((value) => {
                sender.sendMessage(RemoteProtocol.UPDATE_DATASOURCE, {
                    id,
                    value,
                });
            }, token);
            sender.sendMessage(RemoteProtocol.LISTEN_DATASOURCE_OK, {
                id,
                value: endpoint.source.value,
            });
        } else {
            sender.sendMessage(RemoteProtocol.LISTEN_DATASOURCE_ERR, {
                id,
                errorCode: 0,
                error: "No such datasource",
            });
        }
    }

    //@ts-ignore
    private listenArrayDataSource(id: string, sender: Client) {
        const endpoint = this.exposedArrayDataSources.get(id);
        const token = new CancellationToken();
        sender.subscriptions.set(id, token);
        endpoint.source.listen((change) => {
            change = Object.assign({}, change);
            if (change.operation !== "merge") {
                delete change.previousState;
                delete change.newState;
            }
            sender.sendMessage(RemoteProtocol.UPDATE_DATASOURCE, {
                id,
                change,
            });
        }, token);
        sender.sendMessage(RemoteProtocol.LISTEN_DATASOURCE_OK, {
            id,
            value: endpoint.source.getData(),
        });
    }

    //@ts-ignore
    private cancelSubscriptionToExposedSource(sender: Client, message: any) {
        const sub = sender.subscriptions.get(message.url);
        if (sub) {
            sub.cancel();
            sender.subscriptions.delete(message.url);
        }
    }

    /**
     * Makes data public anything pushed to the exposed source will be broadcasted to everyone listening to it
     */
    public exposeDataSource<I>(
        id: string,
        source: DataSource<I>,
        authenticate: (token: string, operation: "read" | "write") => boolean
    ): void {
        this.exposedDataSources.set(id, {
            authenticator: authenticate,
            source,
        });
    }
}
