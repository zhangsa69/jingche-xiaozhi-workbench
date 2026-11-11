use chrono::{DateTime, Duration, Utc};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::error::ApiError;
use crate::util::{iso, now, random_token, sha256_hex};

type HmacSha256 = Hmac<Sha256>;

const TOKEN_VERSION: &str = "v1";

/// Full session token: every authenticated route accepts it.
pub const SCOPE_FULL: &str = "full";
/// Long-lived token handed to the desktop runtime for the model gateway only.
pub const SCOPE_GATEWAY: &str = "gateway";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccessClaims {
    pub sub: String,
    pub role: String,
    pub sid: String,
    pub iat: i64,
    pub exp: i64,
    /// Absent on tokens issued before scopes existed, which are full sessions.
    #[serde(default = "full_scope")]
    pub scope: String,
}

fn full_scope() -> String {
    SCOPE_FULL.to_string()
}

#[derive(Debug)]
pub struct IssuedToken {
    pub token: String,
    pub expires_at: DateTime<Utc>,
}

/// Signs short-lived access tokens with a subkey derived from the server
/// secret. Refresh tokens are opaque random values whose SHA-256 hash is stored.
#[derive(Clone)]
pub struct TokenService {
    access_key: Vec<u8>,
    code_key: Vec<u8>,
}

impl TokenService {
    pub fn new(secret: &[u8]) -> Self {
        Self {
            access_key: derive_key(secret, b"control-plane/access-token"),
            code_key: derive_key(secret, b"control-plane/email-code"),
        }
    }

    pub fn issue_access(
        &self,
        user_id: &str,
        role: &str,
        session_id: &str,
        ttl_secs: i64,
    ) -> Result<IssuedToken, ApiError> {
        self.issue_scoped(user_id, role, session_id, ttl_secs, SCOPE_FULL)
    }

    /// Issues a gateway-scoped token. It is bound to the same session row, so
    /// logout, account disabling, or a password reset revoke it immediately;
    /// it cannot call `/me`, admin routes, or the ledger.
    pub fn issue_gateway(
        &self,
        user_id: &str,
        role: &str,
        session_id: &str,
        ttl_secs: i64,
    ) -> Result<IssuedToken, ApiError> {
        self.issue_scoped(user_id, role, session_id, ttl_secs, SCOPE_GATEWAY)
    }

    fn issue_scoped(
        &self,
        user_id: &str,
        role: &str,
        session_id: &str,
        ttl_secs: i64,
        scope: &str,
    ) -> Result<IssuedToken, ApiError> {
        let issued_at = now();
        let expires_at = issued_at + Duration::seconds(ttl_secs);
        let claims = AccessClaims {
            sub: user_id.to_string(),
            role: role.to_string(),
            sid: session_id.to_string(),
            iat: issued_at.timestamp(),
            exp: expires_at.timestamp(),
            scope: scope.to_string(),
        };
        let payload = serde_json::to_vec(&claims).map_err(|error| {
            tracing::error!(%error, "serializing access token claims");
            ApiError::internal("无法签发访问令牌")
        })?;
        let encoded =
            base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, payload);
        let signature = self.sign(&encoded);
        Ok(IssuedToken {
            token: format!("{TOKEN_VERSION}.{encoded}.{signature}"),
            expires_at,
        })
    }

    pub fn verify_access(&self, token: &str) -> Result<AccessClaims, ApiError> {
        let mut parts = token.split('.');
        let (Some(version), Some(encoded), Some(signature), None) =
            (parts.next(), parts.next(), parts.next(), parts.next())
        else {
            return Err(ApiError::unauthorized(
                "INVALID_TOKEN",
                "访问令牌格式不正确",
            ));
        };
        if version != TOKEN_VERSION || !self.verify_signature(encoded, signature) {
            return Err(ApiError::unauthorized("INVALID_TOKEN", "访问令牌无效"));
        }
        let payload =
            base64::Engine::decode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, encoded)
                .map_err(|_| ApiError::unauthorized("INVALID_TOKEN", "访问令牌无效"))?;
        let claims: AccessClaims = serde_json::from_slice(&payload)
            .map_err(|_| ApiError::unauthorized("INVALID_TOKEN", "访问令牌无效"))?;
        if claims.exp <= now().timestamp() {
            return Err(ApiError::unauthorized(
                "TOKEN_EXPIRED",
                "登录状态已过期，请重新登录",
            ));
        }
        Ok(claims)
    }

    /// Returns the plaintext refresh token and the hash to persist.
    pub fn issue_refresh(&self) -> (String, String) {
        let plaintext = random_token(32);
        let hash = sha256_hex(&plaintext);
        (plaintext, hash)
    }

    pub fn hash_refresh(&self, plaintext: &str) -> String {
        sha256_hex(plaintext)
    }

    pub fn code_digest(&self, code: &str) -> String {
        let mut mac =
            HmacSha256::new_from_slice(&self.code_key).expect("hmac accepts any key length");
        mac.update(code.as_bytes());
        hex::encode(mac.finalize().into_bytes())
    }

    fn sign(&self, encoded: &str) -> String {
        let mut mac =
            HmacSha256::new_from_slice(&self.access_key).expect("hmac accepts any key length");
        mac.update(encoded.as_bytes());
        hex::encode(mac.finalize().into_bytes())
    }

    fn verify_signature(&self, encoded: &str, signature: &str) -> bool {
        let Ok(expected) = hex::decode(signature) else {
            return false;
        };
        let mut mac =
            HmacSha256::new_from_slice(&self.access_key).expect("hmac accepts any key length");
        mac.update(encoded.as_bytes());
        mac.verify_slice(&expected).is_ok()
    }
}

pub fn session_expiry(days: i64) -> (DateTime<Utc>, String) {
    let expires_at = now() + Duration::days(days);
    (expires_at, iso(expires_at))
}

fn derive_key(secret: &[u8], label: &[u8]) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(secret);
    hasher.update(b"|");
    hasher.update(label);
    hasher.finalize().to_vec()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn service() -> TokenService {
        TokenService::new(b"test-secret-value-that-is-long-enough")
    }

    #[test]
    fn access_tokens_round_trip() {
        let service = service();
        let issued = service
            .issue_access("user-1", "admin", "session-1", 600)
            .unwrap();
        let claims = service.verify_access(&issued.token).unwrap();
        assert_eq!(claims.sub, "user-1");
        assert_eq!(claims.role, "admin");
        assert_eq!(claims.sid, "session-1");
    }

    #[test]
    fn gateway_tokens_carry_their_scope() {
        let service = service();
        let issued = service
            .issue_gateway("user-1", "member", "session-1", 600)
            .unwrap();
        let claims = service.verify_access(&issued.token).unwrap();
        assert_eq!(claims.scope, SCOPE_GATEWAY);
        assert_eq!(claims.sid, "session-1");
    }

    #[test]
    fn tokens_without_a_scope_are_full_sessions() {
        let legacy =
            r#"{"sub":"user-1","role":"member","sid":"session-1","iat":0,"exp":9999999999}"#;
        let claims: AccessClaims = serde_json::from_str(legacy).unwrap();
        assert_eq!(claims.scope, SCOPE_FULL);
    }

    #[test]
    fn tampered_tokens_are_rejected() {
        let service = service();
        let issued = service
            .issue_access("user-1", "member", "session-1", 600)
            .unwrap();
        let mut parts: Vec<&str> = issued.token.split('.').collect();
        let forged = format!("{}.{}.{}", parts[0], parts[1], "0".repeat(64));
        assert!(service.verify_access(&forged).is_err());
        parts.reverse();
        assert!(service.verify_access("").is_err());
    }

    #[test]
    fn expired_tokens_are_rejected() {
        let service = service();
        let issued = service
            .issue_access("user-1", "member", "session-1", -10)
            .unwrap();
        assert!(service.verify_access(&issued.token).is_err());
    }

    #[test]
    fn refresh_tokens_are_unique_and_hashed() {
        let service = service();
        let (first, first_hash) = service.issue_refresh();
        let (second, _) = service.issue_refresh();
        assert_ne!(first, second);
        assert_eq!(service.hash_refresh(&first), first_hash);
    }
}
