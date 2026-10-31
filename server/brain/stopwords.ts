/**
 * Everyday Turkish words: they can never be a topic/preference on their own and
 * are not a signal however often they repeat. One list, two readers: the drive
 * layer and the preference counter. Words stay as written (with Turkish letters);
 * each module runs them through its own normalization (`fold` / `normalize`).
 */
export const TR_STOP_WORDS: readonly string[] = [
  've', 'bir', 'bu', 'şu', 'o', 'için', 'ile', 'ama', 'çok', 'daha',
  'gibi', 'kadar', 'sonra', 'önce', 'bugün', 'yarın', 'dün', 'şey', 'var', 'yok',
  'değil', 'iyi', 'kötü', 'güzel', 'zaman', 'nasıl', 'neden', 'ne', 'ben', 'sen',
  'biz', 'siz', 'onlar', 'benim', 'senin', 'yapmak', 'yapıyorum', 'yaptım', 'gidiyor', 'gitti',
  'oldu', 'olur', 'olmaz', 'lazım', 'gerek', 'tamam', 'evet', 'hayır', 'lütfen', 'teşekkür',
  'merhaba', 'selam', 'bilmiyorum', 'istiyorum', 'düşünüyorum', 'bakıyorum', 'geliyor', 'kalıyor',
  'duruyor', 'bilgisayar', 'dosya', 'proje', 'kod', 'hata', 'çalışıyor', 'çalışmıyor', 'deniyorum',
  'sanırım', 'galiba', 'ederim',
];
