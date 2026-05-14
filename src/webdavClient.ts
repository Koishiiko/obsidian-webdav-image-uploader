import { requestUrl, RequestUrlParam, RequestUrlResponse } from "obsidian";
import WebDavImageUploaderPlugin from "./main";
import { getToken } from "./utils";

export class WebDavClient {
	plugin: WebDavImageUploaderPlugin;
	client: WebDavClientInner;

	constructor(plugin: WebDavImageUploaderPlugin) {
		this.plugin = plugin;

		this.initClient();
	}

	initClient() {
		const settings = this.plugin.settings;
		this.client = new WebDavClientInner(
			settings.url,
			settings.username,
			settings.password,
		);
	}

	async downloadFile(url: string, sourcePath?: string) {
		const path = this.getPath(url);
		const fileName = path.split("/").pop()!;

		const resp = await this.client.getFileContents(path);

		const filePath =
			await this.plugin.app.fileManager.getAvailablePathForAttachment(
				fileName,
				sourcePath,
			);
		return await this.plugin.app.vault.createBinary(filePath, resp);
	}

	async uploadFile(file: File, path: string): Promise<FileInfo> {
		const buffer = await file.arrayBuffer();

		const success = await this.client.putFileContents(path, buffer);

		if (!success) {
			throw new Error(`Failed to upload file: '${file.name}'`);
		}

		return { fileName: file.name, url: this.getUrl(path) };
	}

	async renameFile(oldPath: string, newPath: string) {
		await this.client.moveFile(oldPath, newPath, false);
	}

	async testConnection() {
		try {
			const resp = await this.client.customRequest("/", {
				method: "PROPFIND",
				headers: { Depth: "0" },
			});

			// WebDAV servers may return 207 (Multi-Status) for a successful PROPFIND request
			if (resp.status === 207) {
				return null;
			}

			return `Check connection failed: ${resp.status}`;
		} catch (e) {
			return `${e}`;
		}
	}

	async deleteFile(url: string) {
		const path = this.getPath(url);
		await this.client.deleteFile(path);
	}

	getUrl(path: string) {
		return encodeURI(this.plugin.settings.url + path);
	}

	getPath(url: string) {
		return decodeURI(url.replace(this.plugin.settings.url, ""));
	}
}

export interface FileInfo {
	fileName: string;
	url: string;
}

/**
 * refer to: https://github.com/perry-mitchell/webdav-client
 */
class WebDavClientInner {
	private baseUrl: string;
	private authHeader: string;

	constructor(url: string, username?: string, password?: string) {
		this.baseUrl = url.endsWith("/") ? url.slice(0, -1) : url;

		if (username && password) {
			const credentials = getToken(username, password);
			this.authHeader = `Basic ${credentials}`;
		} else {
			this.authHeader = "";
		}
	}

	async putFileContents(path: string, data: ArrayBuffer | string) {
		const encodedPath = this.encodePath(path);
		const url = this.buildUrl(encodedPath);

		const response = await this.request({
			url,
			method: "PUT",
			headers: { "Content-Type": "application/octet-stream" },
			body: data,
		});

		// parent directory not exists
		if (response.status === 409) {
			await this.ensureDirectoryExists(
				path.substring(0, path.lastIndexOf("/")),
			);

			await this.putFileContents(path, data);

			return;
		} else {
			this.handleResponseCode(response);
		}

		return true;
	}

	async getFileContents(path: string) {
		const encodedPath = this.encodePath(path);
		const url = this.buildUrl(encodedPath);

		const response = await this.request({
			url,
			method: "GET",
		});

		this.handleResponseCode(response);

		return response.arrayBuffer;
	}

	async moveFile(oldPath: string, newPath: string, overwrite = false) {
		const url = this.buildUrl(this.encodePath(oldPath));

		if (!overwrite) {
			// BUG: `Overwite: 'F'` header may not working for some WebDAV server
			// check the file manually
			const exists = await this.exists(newPath);
			if (exists) {
				throw new Error(
					`Destination file already exists: '${newPath}'`,
				);
			}
		}

		const newUrl = this.buildUrl(this.encodePath(newPath));

		const response = await this.request({
			url,
			method: "MOVE",
			headers: {
				Destination: newUrl,
				Overwrite: overwrite ? "T" : "F",
			},
		});

		// parent directory not exists
		if ([404, 409, 500].includes(response.status)) {
			await this.ensureDirectoryExists(
				newPath.substring(0, newPath.lastIndexOf("/")),
			);
			await this.moveFile(oldPath, newPath, overwrite);
			return;
		}

		// file already exists
		if (response.status === 412) {
			throw new Error(`Destination file already exists: '${newPath}'`);
		}

		this.handleResponseCode(response);

		return;
	}

	async deleteFile(path: string) {
		const encodedPath = this.encodePath(path);
		const url = this.buildUrl(encodedPath);

		const response = await this.request({
			url,
			method: "DELETE",
		});

		this.handleResponseCode(response);
	}

	async createDirectory(path: string): Promise<RequestUrlResponse> {
		const encodedPath = this.encodePath(path);
		const url = this.buildUrl(encodedPath);

		return await this.request({
			url,
			method: "MKCOL",
		});
	}

	async exists(path: string) {
		const encodedPath = this.encodePath(path);
		const url = this.buildUrl(encodedPath);

		const response = await this.request({
			url,
			method: "HEAD",
		});

		if (response.status === 200) {
			return true;
		}

		if (response.status === 404) {
			return false;
		}

		this.handleResponseCode(response);

		return false;
	}

	async ensureDirectoryExists(path: string) {
		const directories = path.split("/").filter((dir) => dir !== "");
		let currentPath = "";

		for (const dir of directories) {
			currentPath += "/" + dir;
			const response = await this.createDirectory(currentPath);
			if ([405, 409].includes(response.status)) {
				// most webdav servers return 405/409 if the directory already exists
				console.warn(
					`Directory already exists or cannot be created: ${currentPath}`,
				);
			} else {
				this.handleResponseCode(response);
			}
		}
	}

	async customRequest(
		path: string,
		options: {
			method: string;
			headers?: Record<string, string>;
			body?: ArrayBuffer | string;
		},
	) {
		const { method, headers = {}, body } = options;

		const encodedPath = this.encodePath(path);
		const url = this.buildUrl(encodedPath);

		return await this.request({
			url,
			method,
			headers,
			body,
		});
	}

	private buildUrl(path: string) {
		if (!path.startsWith("/")) {
			path = "/" + path;
		}
		return this.baseUrl + path;
	}

	private encodePath(path: string) {
		return path
			.split("/")
			.map((segment) => encodeURIComponent(segment))
			.join("/");
	}

	private async request(options: {
		url: string;
		method: string;
		headers?: Record<string, string>;
		body?: ArrayBuffer | string;
	}) {
		const { url, method, headers = {}, body } = options;

		const requestOptions: RequestUrlParam = {
			url,
			method,
			headers: {
				Authorization: this.authHeader,
				...headers,
			},
			body: body,
			throw: false,
		};

		return await requestUrl(requestOptions);
	}

	private handleResponseCode(response: RequestUrlResponse) {
		if (response.status >= 400) {
			throw new Error(
				`${response.status} ${response.text ?? "Unknown error"}`,
			);
		}
	}
}
