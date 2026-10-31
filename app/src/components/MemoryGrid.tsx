import { useState } from 'react';
import type { Note } from '../../../server/memory/notes.js';
import { useI18n } from '../i18n.js';

type NoteView = Note & { strength?: number };

export function MemoryGrid(props: {
  notes: NoteView[];
  query: string;
  onSearch: (query: string) => void;
  onForget: (id: string) => void;
  onTrauma: (id: string) => Promise<void> | void;
  onRestore: (id: string) => void;
  onCorrect: (id: string, text: string) => void;
  onResolveConflict: (aId: string, bId: string, winner: 'a' | 'b') => void;
  conflicts: { a: NoteView; b: NoteView }[];
  focusNoteId?: string | null;
  onSleep: () => void;
  showDormant: boolean;
  onToggleDormant: () => void;
  busy?: boolean;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [traumaBusy, setTraumaBusy] = useState<Set<string>>(new Set());

  return (
    <section className="skills">
      <div className="memory-head">
        <h2>{t('memory.title')}</h2>
        <div className="memory-actions">
          <label className="toggle">
            <input type="checkbox" checked={props.showDormant} onChange={props.onToggleDormant} />
            {t('memory.showDormant')}
          </label>
          <button onClick={props.onSleep} disabled={props.busy}>
            {props.busy ? t('memory.sleeping') : t('memory.sleep')}
          </button>
        </div>
      </div>

      {props.conflicts.length > 0 && (
        <div className="conflicts">
          <h3>{t('memory.conflicts')}</h3>
          <p className="hint">{t('memory.conflictHint')}</p>
          {props.conflicts.map((pair) => (
            <div key={`${pair.a.id}-${pair.b.id}`} className="conflict-row">
              <span>{pair.a.text}</span>
              <span className="conflict-vs">↔</span>
              <span>{pair.b.text}</span>
              <button onClick={() => props.onResolveConflict(pair.a.id, pair.b.id, 'a')}>{t('memory.keepLeft')}</button>
              <button onClick={() => props.onResolveConflict(pair.a.id, pair.b.id, 'b')}>{t('memory.keepRight')}</button>
            </div>
          ))}
        </div>
      )}

      <form
        className="repo-add"
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <input
          value={props.query}
          onChange={(event) => props.onSearch(event.target.value)}
          placeholder={t('memory.searchPlaceholder')}
        />
      </form>

      {props.notes.length === 0 && (
        <p className="empty">
          {props.query ? t('memory.noResults') : t('memory.empty')}
        </p>
      )}

      <div className="memory-list">
        {props.notes.map((note) => (
          <article key={note.id} className={`note ${note.dormant ? 'dormant' : ''} ${note.forgotten ? 'forgotten' : ''} ${note.id === props.focusNoteId ? 'focused' : ''}`}>
            <div className="note-head">
              <span className={`tag ${note.kind}`}>{note.kind === 'semantic' ? t('memory.kind.semantic') : t('memory.kind.episodic')}</span>
              {note.isTrauma && <span className="tag trauma">{t('memory.traumaBadge')}</span>}
              <span className="note-meta">
                {t('memory.strength')} {(note.strength ?? note.base).toFixed(2)} · {t('memory.recallCount', { count: note.recallCount })}
                {note.corrected ? ` · ${t('memory.corrected')}` : ''}
                {note.dormant ? ` · ${t('memory.dormantBadge')}` : ''}
              </span>
            </div>

            {editing?.id === note.id ? (
              <div className="note-edit">
                <textarea value={editing.text} onChange={(event) => setEditing({ id: note.id, text: event.target.value })} rows={3} />
                <div className="repo-actions">
                  <button
                    className="primary"
                    onClick={() => {
                      props.onCorrect(note.id, editing.text);
                      setEditing(null);
                    }}
                  >
                    {t('common.save')}
                  </button>
                  <button onClick={() => setEditing(null)}>{t('common.cancel')}</button>
                </div>
              </div>
            ) : (
              <p className="note-text">{note.text}</p>
            )}

            {note.concepts.length > 0 && (
              <p className="triggers">{note.concepts.map((c) => `#${c}`).join(' ')}</p>
            )}
            <p className="note-evidence">
              {t('memory.sources')}: {note.evidence.length > 0 ? note.evidence.map((id) => `#${id}`).join(' ') : t('common.none')}
            </p>

            <div className="repo-actions">
              <button onClick={() => setEditing({ id: note.id, text: note.text })}>{t('memory.correct')}</button>
              {note.forgotten || note.dormant ? (
                <button onClick={() => props.onRestore(note.id)}>{t('memory.restore')}</button>
              ) : (
                <button onClick={() => props.onForget(note.id)}>{t('memory.forget')}</button>
              )}
              {!note.isTrauma && (
                <button
                  className="ghost"
                  disabled={traumaBusy.has(note.id)}
                  onClick={() => {
                    if (!window.confirm(t('memory.traumaConfirm'))) return;
                    setTraumaBusy((current) => new Set(current).add(note.id));
                    void Promise.resolve(props.onTrauma(note.id)).finally(() =>
                      setTraumaBusy((current) => {
                        const next = new Set(current);
                        next.delete(note.id);
                        return next;
                      }),
                    );
                  }}
                >
                  {traumaBusy.has(note.id) ? t('memory.markingTrauma') : t('memory.markTrauma')}
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
