import { useState } from 'react';
import type { SessionInfo } from '../../../server/sessions.js';

export function SessionMenu(props: {
  sessions: SessionInfo[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  const [open, setOpen] = useState(false);
  const active = props.sessions.find((s) => s.id === props.activeId);

  return (
    <div className="menu">
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {active ? active.title : 'Oturumlar'} ▾
      </button>
      {open && (
        <div className="menu-panel">
          <button className="menu-create" onClick={() => { props.onCreate(); setOpen(false); }}>
            + Yeni oturum
          </button>
          {props.sessions.map((session) => (
            <button
              key={session.id}
              className={`menu-item ${session.id === props.activeId ? 'active' : ''}`}
              onClick={() => { props.onSelect(session.id); setOpen(false); }}
            >
              <span className={`dot ${session.status}`} />
              <span className="menu-title">
                {session.role === 'brain' && <span className="brain-mark">◆</span>}
                {session.title}
              </span>
              <span className="menu-cwd">{session.cwd}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
