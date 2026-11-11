import { describe, expect, it } from "vitest";
import { formatBeans, gatewayProviderBaseUrl, normalizeControlPlaneBaseUrl } from "./control-plane.js";

describe("gatewayProviderBaseUrl", () => {
  it("drops the completions suffix the runtime appends itself", () => {
    expect(gatewayProviderBaseUrl("https://cp.example.com/api/v1/gateway/chat/completions")).toBe(
      "https://cp.example.com/api/v1/gateway",
    );
    expect(gatewayProviderBaseUrl("https://cp.example.com/api/v1/gateway/")).toBe(
      "https://cp.example.com/api/v1/gateway",
    );
  });

  it("rejects values that are not usable provider origins", () => {
    expect(gatewayProviderBaseUrl(null)).toBeNull();
    expect(gatewayProviderBaseUrl("")).toBeNull();
    expect(gatewayProviderBaseUrl("not a url")).toBeNull();
    expect(gatewayProviderBaseUrl("ftp://cp.example.com/v1")).toBeNull();
  });
});

describe("normalizeControlPlaneBaseUrl", () => {
  it("trims trailing slashes so endpoint joins stay single-slash", () => {
    expect(normalizeControlPlaneBaseUrl("https://xiaozhi.example.com/")).toBe("https://xiaozhi.example.com");
    expect(normalizeControlPlaneBaseUrl("  https://xiaozhi.example.com//  ")).toBe("https://xiaozhi.example.com");
  });

  it("keeps a deployment path prefix", () => {
    expect(normalizeControlPlaneBaseUrl("https://example.com/control-plane/")).toBe(
      "https://example.com/control-plane",
    );
  });

  it("allows cleartext only on loopback", () => {
    expect(normalizeControlPlaneBaseUrl("http://127.0.0.1:8787")).toBe("http://127.0.0.1:8787");
    expect(normalizeControlPlaneBaseUrl("http://localhost:8787/")).toBe("http://localhost:8787");
    expect(normalizeControlPlaneBaseUrl("http://xiaozhi.example.com")).toBeNull();
  });

  it("keeps LAN cleartext opt-in", () => {
    expect(normalizeControlPlaneBaseUrl("http://10.120.65.148:18787")).toBeNull();
    expect(normalizeControlPlaneBaseUrl("http://10.120.65.148:18787", { allowInsecure: true })).toBe(
      "http://10.120.65.148:18787",
    );
  });

  it("accepts every RFC1918 range and IPv6 unique-local when opted in", () => {
    for (const host of ["10.0.0.5", "172.16.3.4", "172.31.255.1", "192.168.100.7"]) {
      expect(normalizeControlPlaneBaseUrl(`http://${host}:8080`, { allowInsecure: true })).toBe(
        `http://${host}:8080`,
      );
    }
    expect(normalizeControlPlaneBaseUrl("http://[fd00::1234]:8080", { allowInsecure: true })).toBe(
      "http://[fd00::1234]:8080",
    );
  });

  it("still refuses public cleartext and out-of-range addresses when opted in", () => {
    expect(normalizeControlPlaneBaseUrl("http://xiaozhi.example.com", { allowInsecure: true })).toBeNull();
    expect(normalizeControlPlaneBaseUrl("http://172.32.0.1:8080", { allowInsecure: true })).toBeNull();
    expect(normalizeControlPlaneBaseUrl("http://8.8.8.8", { allowInsecure: true })).toBeNull();
  });

  it("never needs the opt-in for https", () => {
    expect(normalizeControlPlaneBaseUrl("https://10.120.65.148:18787")).toBe("https://10.120.65.148:18787");
  });

  it("rejects values that are not usable origins", () => {
    expect(normalizeControlPlaneBaseUrl("")).toBeNull();
    expect(normalizeControlPlaneBaseUrl("   ")).toBeNull();
    expect(normalizeControlPlaneBaseUrl(undefined)).toBeNull();
    expect(normalizeControlPlaneBaseUrl("xiaozhi.example.com")).toBeNull();
    expect(normalizeControlPlaneBaseUrl("ftp://xiaozhi.example.com")).toBeNull();
    expect(normalizeControlPlaneBaseUrl("https://user:secret@xiaozhi.example.com")).toBeNull();
  });
});

describe("formatBeans", () => {
  it("groups thousands and caps decimals", () => {
    expect(formatBeans(1234.5678)).toBe("1,234.568");
    expect(formatBeans(0)).toBe("0");
  });

  it("renders unknown values as an em dash", () => {
    expect(formatBeans(null)).toBe("—");
    expect(formatBeans(undefined)).toBe("—");
    expect(formatBeans(Number.NaN)).toBe("—");
  });
});
