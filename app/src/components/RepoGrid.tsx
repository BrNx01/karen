import { useState } from 'react';
import type { Repo } from '../../../server/repos.js';
import { useI18n } from '../i18n.js';

export function RepoGrid(props: {
  repos: Repo[];
  onOpen: (repo: Repo) => void;
  onAdd: (path: string) => void;
  onRemove: (id: string) => void;
}) {
  const { t } = useI18n();
  const [path, setPath] = useState('');

  return (
    <section className="repos">
      <h2>{t('repos.title')}</h2>
      <form
        className="repo-add"
        onSubmit={(event) => {
          event.preventDefault();
          if (path.trim() === '') return;
          props.onAdd(path.trim());
          setPath('');
        }}
      >
        <input
          value={path}
          onChange={(event) => setPath(event.target.value)}
          placeholder={t('repos.pathPrompt')}
        />
        <button type="submit">{t('repos.add')}</button>
      </form>

      {props.repos.length === 0 && <p className="empty">{t('repos.empty')}</p>}

      <div className="repo-grid">
        {props.repos.map((repo) => (
          <article key={repo.id} className="repo-card">
            <h3>{repo.name}</h3>
            <p className="repo-path">{repo.path}</p>
            <div className="repo-actions">
              <button className="primary" onClick={() => props.onOpen(repo)}>{t('common.open')}</button>
              <button onClick={() => props.onRemove(repo.id)}>{t('repos.remove')}</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
