import {
    ArrayDataSource,
    CancellationToken,
    DataSource,
    DuplexDataSource,
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
    onError?: (client: Client, error: string) => void;
}

export class AurumServer {
    private wsServer: ws.Server;
    private wsServerClients: Client[];
    private config: AurumServerConfig;

    private exposedDataSources: Map<
        string,
        {
            source: DataSource<any>;
            authenticator(token: string, operation: "read"): boolean;
        }
    >;

    private exposedDuplexDataSources: Map<
        string,
        {
            source: DuplexDataSource<any>;
            authenticator(token: string, operation: "read" | "write"): boolean;
        }
    >;
    private exposedArrayDataSources: Map<
        string,
        {
            source: ArrayDataSource<any>;
            authenticator(token: string, operation: "read"): boolean;
        }
    >;

    private constructor(config: AurumServerConfig) {
        this.config = config;

        this.exposedDataSources = new Map();
        this.exposedDuplexDataSources = new Map();
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

            ws.on("message", (data) => {
                server.processMessage(client, data);
            });

            ws.on("close", () => {
                server.wsServerClients.splice(
                    server.wsServerClients.indexOf(client),
                    1
                );
                client.dispose();
                config.onClientDisconnected?.(client);
            });
            config.onClientConnected?.(client);
        });

        return server;
    }

    private processMessage(sender: Client, data: ws.Data): void {
        if (typeof data === "string") {
            if (data.length >= this.config.maxMessageSize) {
                this.config.onError?.(
                    sender,
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
                    case RemoteProtocol.LISTEN_DUPLEX_DATASOURCE:
                        this.listenDuplexDataSource(message, sender);
                        break;
                    case RemoteProtocol.LISTEN_ARRAY_DATASOURCE:
                        this.listenArrayDataSource(message, sender);
                        break;
                    case RemoteProtocol.UPDATE_DUPLEX_DATASOURCE:
                        this.updateDuplexDataSource(message, sender);
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

            if (endpoint.authenticator(message.token, "read")) {
                endpoint.source.listenAndRepeat((value) => {
                    sender.sendMessage(RemoteProtocol.UPDATE_DATASOURCE, {
                        id,
                        value,
                    });
                }, token);
            } else {
                sender.sendMessage(RemoteProtocol.LISTEN_DATASOURCE_ERR, {
                    id,
                    errorCode: 401,
                    error: "Unauthorized",
                });
            }
        } else {
            sender.sendMessage(RemoteProtocol.LISTEN_DATASOURCE_ERR, {
                id,
                errorCode: 404,
                error: "No such datasource",
            });
        }
    }

    private listenArrayDataSource(message: any, sender: Client) {
        const id = message.id;
        if (this.exposedArrayDataSources.has(id)) {
            const endpoint = this.exposedArrayDataSources.get(id);
            const token = new CancellationToken();
            sender.subscriptions.set(id, token);
            if (endpoint.authenticator(message.token, "read")) {
                endpoint.source.listenAndRepeat((change) => {
                    change = Object.assign({}, change);
                    // Optimize network traffic by removing fields not used by the client
                    delete change.operation;
                    delete change.previousState;
                    delete change.newState;
                    sender.sendMessage(RemoteProtocol.UPDATE_ARRAY_DATASOURCE, {
                        id,
                        change,
                    });
                }, token);
            } else {
                sender.sendMessage(RemoteProtocol.LISTEN_ARRAY_DATASOURCE_ERR, {
                    id,
                    errorCode: 401,
                    error: "Unauthorized",
                });
            }
        } else {
            sender.sendMessage(RemoteProtocol.LISTEN_ARRAY_DATASOURCE_ERR, {
                id,
                errorCode: 404,
                error: "No such array datasource",
            });
        }
    }

    private listenDuplexDataSource(message: any, sender: Client) {
        const id = message.id;
        if (this.exposedDuplexDataSources.has(id)) {
            const endpoint = this.exposedDuplexDataSources.get(id);
            const token = new CancellationToken();
            sender.subscriptions.set(id, token);

            if (endpoint.authenticator(message.token, "read")) {
                endpoint.source.listenAndRepeat((value) => {
                    sender.sendMessage(
                        RemoteProtocol.UPDATE_DUPLEX_DATASOURCE,
                        {
                            id,
                            value,
                        }
                    );
                }, token);
            } else {
                sender.sendMessage(
                    RemoteProtocol.LISTEN_DUPLEX_DATASOURCE_ERR,
                    {
                        id,
                        errorCode: 401,
                        error: "Unauthorized",
                    }
                );
            }
        } else {
            sender.sendMessage(RemoteProtocol.LISTEN_DUPLEX_DATASOURCE_ERR, {
                id,
                errorCode: 404,
                error: "No such duplex datasource",
            });
        }
    }

    private updateDuplexDataSource(message: any, sender: Client) {
        const id = message.id;
        if (this.exposedDuplexDataSources.has(id)) {
            const endpoint = this.exposedDuplexDataSources.get(id);

            if (endpoint.authenticator(message.token, "write")) {
                endpoint.source.updateUpstream(message.value);
            } else {
                sender.sendMessage(
                    RemoteProtocol.UPDATE_DUPLEX_DATASOURCE_ERR,
                    {
                        id,
                        errorCode: 401,
                        error: "Unauthorized",
                    }
                );
            }
        } else {
            sender.sendMessage(RemoteProtocol.UPDATE_DUPLEX_DATASOURCE_ERR, {
                id,
                errorCode: 404,
                error: "No such duplex datasource",
            });
        }
    }

    //@ts-ignore
    private cancelSubscriptionToExposedSource(sender: Client, message: any) {
        const sub = sender.subscriptions.get(message.url);
        if (sub) {
            sub.cancel();
            sender.subscriptions.delete(message.url);
        }
    }

    public exposeDataSource<I>(
        id: string,
        source: DataSource<I>,
        authenticate: (token: string, operation: "read") => boolean = () => true
    ): void {
        this.exposedDataSources.set(id, {
            authenticator: authenticate,
            source,
        });
    }

    public exposeArrayDataSource<I>(
        id: string,
        source: ArrayDataSource<I>,
        authenticate: (token: string, operation: "read") => boolean = () => true
    ): void {
        this.exposedArrayDataSources.set(id, {
            authenticator: authenticate,
            source,
        });
    }

    public exposeDuplexDataSource<I>(
        id: string,
        source: DuplexDataSource<I>,
        authenticate: (
            token: string,
            operation: "read" | "write"
        ) => boolean = () => true
    ): void {
        this.exposedDuplexDataSources.set(id, {
            authenticator: authenticate,
            source,
        });
    }
}
