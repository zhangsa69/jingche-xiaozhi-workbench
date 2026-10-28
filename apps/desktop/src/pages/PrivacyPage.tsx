import { useTranslation } from "react-i18next";
import { api } from "../lib/api";
import { Button } from "../components/ui";
import { PRIVACY_ROWS } from "../lib/privacy-manifest";

/**
 * W-21. A comparison table, not a policy document: the question a user actually
 * asks is "what leaves this machine", so every row puts both answers side by
 * side instead of making them read a paragraph and hope it is unambiguous.
 *
 * The rows come from `lib/privacy-manifest`, which is the single source the
 * test checks against all eight locales.
 */
export function PrivacyPage() {
  const { t } = useTranslation();

  return (
    <div className="settings-stack">
      <p className="privacy-intro">{t("settings.privacyIntro")}</p>

      <div className="settings-panel privacy-panel">
        <table className="privacy-table">
          <thead>
            <tr>
              <th scope="col">{t("settings.privacyTopicColumn")}</th>
              <th scope="col">{t("settings.privacyUpstreamColumn")}</th>
              <th scope="col">{t("settings.privacyLocalColumn")}</th>
            </tr>
          </thead>
          <tbody>
            {PRIVACY_ROWS.map((row) => (
              <tr key={row.id}>
                <th scope="row">{t(row.topicKey)}</th>
                <td>{t(row.upstreamKey)}</td>
                <td>{t(row.localKey)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="privacy-footnote">
        <span>{t("settings.privacyPolicyNote")}</span>
        <Button variant="secondary" onClick={() => void api.openLogs()}>
          {t("settings.privacyOpenLogs")}
        </Button>
      </div>
    </div>
  );
}
