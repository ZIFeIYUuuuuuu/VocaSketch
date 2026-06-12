export interface Session {
  sessionId: string;
  clientId?: string;
  locale: string;
  expiresAt: string | null;
  createdAt: string;
}
