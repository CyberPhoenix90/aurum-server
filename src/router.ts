import { DataSource, ArrayDataSource, DuplexDataSource } from "aurumjs";

export interface Endpoint<S, T = "read"> {
    source: S;
    authenticator(token: string, operation: T): boolean;
}

export class Router {
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

    constructor() {
        this.exposedDataSources = new Map();
        this.exposedDuplexDataSources = new Map();
        this.exposedArrayDataSources = new Map();
    }

    public getExposedDataSource(id: string): Endpoint<DataSource<any>> {
        return this.exposedDataSources.get(id);
    }

    public getExposedArrayDataSource(
        id: string
    ): Endpoint<ArrayDataSource<any>> {
        return this.exposedArrayDataSources.get(id);
    }

    public getExposedDuplexDataSource(
        id: string
    ): Endpoint<DuplexDataSource<any>, "read" | "write"> {
        return this.exposedDuplexDataSources.get(id);
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
        authenticate?: (token: string, operation: "read") => boolean
    ): void {
        this.exposedArrayDataSources.set(id, {
            authenticator: authenticate,
            source,
        });
    }

    public exposeDuplexDataSource<I>(
        id: string,
        source: DuplexDataSource<I>,
        authenticate?: (token: string, operation: "read" | "write") => boolean
    ): void {
        this.exposedDuplexDataSources.set(id, {
            authenticator: authenticate,
            source,
        });
    }
}
