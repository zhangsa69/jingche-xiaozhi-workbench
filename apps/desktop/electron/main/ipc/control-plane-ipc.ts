import { IPC } from "@pi-desktop/shared";
import type { ControlPlaneClient } from "../control-plane-client";
import type { ControlPlaneProviderBridge } from "../runtime/control-plane-provider";
import type { IpcRegistrar } from "./types";

export type ControlPlaneIpcDependencies = {
  registrar: IpcRegistrar;
  client: ControlPlaneClient;
  providers: ControlPlaneProviderBridge;
};

type SignInInput = { email?: unknown; password?: unknown };
type RegisterInput = {
  email?: unknown;
  code?: unknown;
  password?: unknown;
  displayName?: unknown;
};
type CodeInput = { email?: unknown; purpose?: unknown };
type ResetInput = { email?: unknown; code?: unknown; password?: unknown };

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} is required`);
  }
  return value;
}

/**
 * Registers the control-plane channels. Only identity and quota projections
 * cross into the renderer; tokens stay in this process.
 *
 * Every entry point that establishes a session also refreshes the company
 * gateway provider, so the model picker is ready before the workspace paints.
 */
export function registerControlPlaneIpc({
  registrar,
  client,
  providers,
}: ControlPlaneIpcDependencies): ControlPlaneClient {
  const handle = (channel: string, fn: (...args: any[]) => Promise<any>) => {
    registrar.handle(channel, fn);
  };

  const sync = async (status: Awaited<ReturnType<ControlPlaneClient["status"]>>) => {
    if (status.signedIn) {
      await providers.sync(status);
    }
    return status;
  };

  handle(IPC.invoke.controlPlaneStatus, async () => sync(await client.status()));

  handle(IPC.invoke.controlPlaneLogin, async (input: SignInInput) =>
    sync(await client.login(text(input?.email, "email").trim(), text(input?.password, "password"))),
  );

  handle(IPC.invoke.controlPlaneRegister, async (input: RegisterInput) => {
    const displayName = typeof input?.displayName === "string" ? input.displayName.trim() : "";
    return sync(
      await client.register({
        email: text(input?.email, "email").trim(),
        code: text(input?.code, "code").trim(),
        password: text(input?.password, "password"),
        ...(displayName ? { displayName } : {}),
      }),
    );
  });

  handle(IPC.invoke.controlPlaneRequestCode, async (input: CodeInput) => {
    const purpose = input?.purpose === "reset" ? "reset" : "register";
    return client.requestCode(text(input?.email, "email").trim(), purpose);
  });

  handle(IPC.invoke.controlPlaneResetPassword, async (input: ResetInput) =>
    client.resetPassword({
      email: text(input?.email, "email").trim(),
      code: text(input?.code, "code").trim(),
      password: text(input?.password, "password"),
    }),
  );

  handle(IPC.invoke.controlPlaneLogout, async () => {
    const result = await client.logout();
    // The gateway token is bound to the revoked session, but disabling the row
    // also stops a signed-out client from attempting it at all.
    await providers.deactivate();
    return result;
  });

  handle(IPC.invoke.controlPlaneRefreshProfile, async () => sync(await client.refreshProfile()));

  return client;
}
