// Cloudflare uses this declaration as an extension point for project bindings.
export interface Env {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
}
