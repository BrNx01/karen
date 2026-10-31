import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Windows CI'de sunucu açıp kapatan testler 5 sn'yi aşabiliyor.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Testler paralel çalışırken port/DB çakışmasın diye tek iş parçacığı.
    pool: 'threads',
    poolOptions: { threads: { singleThread: true } },
  },
});
