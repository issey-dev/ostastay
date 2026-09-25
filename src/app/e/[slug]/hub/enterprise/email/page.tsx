import { enterprisePage } from "@/lib/hub-page"
import { HubPageHeader } from "@/components/hub/hub-page-header"
import { HubSetupNotice } from "@/components/hub/hub-setup-notice"
import { ControlsCard } from "@/components/controls/controls-card"
import { SmtpSftpManager } from "@/components/controls/smtp-sftp-manager"

export default async function HubEnterpriseEmailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { item } = await enterprisePage(params, "email")
  return (
    <div className="space-y-6">
      <HubPageHeader title={item.title} icon={item.icon} scope="enterprise" />
      <HubSetupNotice title={item.title} />
      <ControlsCard title="SMTP / SFTP" description="The outgoing mail server every property's guest email is sent through, and the file-transfer connection for exports.">
        <SmtpSftpManager />
      </ControlsCard>
    </div>
  )
}
