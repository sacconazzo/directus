import { Accountability } from '@directus/shared/types';
import { IncomingMessage, Server as httpServer } from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import { parse } from 'url';
import { SocketControllerConfig, WebRequest } from '../types';
import logger from '../../logger';
import { getAccountabilityForToken } from '../../utils/get-accountability-for-token';
import internal from 'stream';
import { extractToken } from '../utils';
import emitter from '../../emitter';

export const defaultSocketConfig: SocketControllerConfig = {
	endpoint: '/websocket',
	auth: { mode: 'strict' },
};

export default abstract class SocketController {
	config: SocketControllerConfig;
	server: WebSocket.Server;
	// hook the websocket handler into the express server
	constructor(httpServer: httpServer, config?: SocketControllerConfig) {
		this.server = new WebSocketServer({ noServer: true });
		this.config = config ?? defaultSocketConfig;

		httpServer.on('upgrade', this.handleUpgrade.bind(this));
	}
	private async handleUpgrade(request: IncomingMessage, socket: internal.Duplex, head: Buffer) {
		const { pathname, query } = parse(request.url!, true);
		if (pathname === this.config.endpoint) {
			const req = request as WebRequest;
			if (this.config.auth.mode === 'strict') {
				let accountability: Accountability | undefined;
				// check token before upgrading when not set to public access
				try {
					accountability = await getAccountabilityForToken(extractToken(request, query));
				} catch {
					accountability = undefined;
				}
				if (!accountability || !accountability.user) {
					// do we need to check the role?
					logger.debug('Websocket upgrade denied - ' + JSON.stringify(accountability || 'invalid'));
					socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
					socket.destroy();
					return;
				}
				if (accountability) req.accountability = accountability;
			}
			this.server.handleUpgrade(request, socket, head, async (ws) => {
				try {
					const _req = await emitter.emitFilter('websocket.upgrade', req, { config: this.config });
					this.server.emit('connection', ws, _req);
				} catch (error: any) {
					// logger.error('upgrade stopped ', JSON.stringify(error));
					ws.send(JSON.stringify({ error: error.message }));
					ws.close();
				}
			});
		}
	}
	terminate() {
		this.server.clients.forEach((ws) => {
			ws.terminate();
		});
	}
}
