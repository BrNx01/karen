import { useState } from 'react';
import type { InstalledSkill } from '../../../server/skills.js';
import { useI18n } from '../i18n.js';

export function SkillGrid(props: {
  skills: InstalledSkill[];
  error?: string | null;
  onAdd: (source: { path?: string; git?: string }) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onRemove: (id: string) => void;
}) {
  const { t } = useI18n();
  const [source, setSource] = useState('');
  const [detail, setDetail] = useState<InstalledSkill | null>(null);

  return (
    <section className="skills">
      <h2>{t('skills.title')}</h2>
      <p className="hint">{t('skills.importHint')}</p>

      <form
        className="repo-add"
        onSubmit={(event) => {
          event.preventDefault();
          const value = source.trim();
          if (value === '') return;
          props.onAdd(/^(https?|ssh|git):\/\/|^git@|^[\w.-]+@[\w.-]+:/.test(value) ? { git: value } : { path: value });
          setSource('');
        }}
      >
        <input
          value={source}
          onChange={(event) => setSource(event.target.value)}
          placeholder={t('skills.importPlaceholder')}
        />
        <button type="submit">{t('skills.add')}</button>
      </form>

      {props.skills.length === 0 && <p className="empty">{t('skills.empty')}</p>}

      <div className="repo-grid">
        {props.skills.map((skill) => (
          <article key={skill.id} className={`repo-card ${skill.enabled ? '' : 'off'}`}>
            <h3>{skill.name}</h3>
            <p className="repo-path">{skill.description || '—'}</p>
            {skill.triggers.length > 0 && (
              <p className="triggers">{skill.triggers.map((trigger) => `#${trigger}`).join(' ')}</p>
            )}
            <div className="repo-actions">
              <button onClick={() => setDetail(skill)}>{t('skills.preview')}</button>
              <button onClick={() => props.onToggle(skill.id, !skill.enabled)}>
                {skill.enabled ? t('skills.disable') : t('skills.enable')}
              </button>
              <button onClick={() => props.onRemove(skill.id)}>{t('common.remove')}</button>
            </div>
          </article>
        ))}
      </div>

      {detail && (
        <div className="preview">
          <div className="preview-head">
            <strong>{detail.name}</strong>
            <button onClick={() => setDetail(null)}>{t('common.close')}</button>
          </div>
          <pre>{detail.body}</pre>
        </div>
      )}
    </section>
  );
}
