import type { Message, PendingApproval } from '../state.js';
import { useI18n } from '../i18n.js';

export function Chat(props: { messages: Message[]; streaming: boolean }) {
  const { t } = useI18n();
  return (
    <div className="chat">
      {props.messages.length === 0 && (
        <div className="chat-empty">
          <img src="/karen-mark-round.svg" alt="" width={64} height={64} />
          <p>{t('chat.ready')}</p>
        </div>
      )}
      {props.messages.map((message) => (
        <div key={message.id} className={`bubble ${message.role}`}>
          <pre>{message.text}</pre>
        </div>
      ))}
      {props.streaming && <div className="bubble assistant pending">…</div>}
    </div>
  );
}

export function ApprovalCard(props: {
  approval: PendingApproval;
  sessionTitle?: string;
  onDecide: (allow: boolean) => void;
}) {
  const { approval } = props;
  const { t } = useI18n();
  const detail =
    typeof approval.args['command'] === 'string'
      ? approval.args['command']
      : JSON.stringify(approval.args);
  return (
    <div className="approval">
      <div className="approval-head">
        <strong>{t('chat.approvalTitle')}</strong>
        <span className="tag">{approval.tool}</span>
        {props.sessionTitle && <span className="tag approval-session">{props.sessionTitle}</span>}
      </div>
      <code className="approval-detail">{detail}</code>
      <p className="approval-reason">{approval.reason}</p>
      <div className="approval-actions">
        <button className="primary" onClick={() => props.onDecide(true)}>{t('chat.approvalAllow')}</button>
        <button onClick={() => props.onDecide(false)}>{t('chat.approvalDeny')}</button>
      </div>
    </div>
  );
}
