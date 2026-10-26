// Sahar — traducciones (las usan la app y el servidor)
(function (root) {
  const LANG_NAMES = {
    de: 'Deutsch', en: 'English', es: 'Español', tr: 'Türkçe', ru: 'Русский', uk: 'Українська',
    pl: 'Polski', ar: 'العربية', fa: 'فارسی', it: 'Italiano', ro: 'Română',
  };
  const RTL = ['ar', 'fa'];
  const LOCALES = { de: 'de-DE', en: 'en-GB', es: 'es-ES', tr: 'tr-TR', ru: 'ru-RU', uk: 'uk-UA', pl: 'pl-PL', ar: 'ar', fa: 'fa-IR', it: 'it-IT', ro: 'ro-RO' };

  // Mensajes predeterminados (mismo orden en todos los idiomas)
  const MESSAGES = {
    es: ['Te estoy pensando ❤️', 'Eres mi persona favorita', 'Te amo muchísimo', 'Pensé en ti y sonreí', 'Gracias por existir en mi vida', 'Contigo todo es más bonito 💕', 'Aquí estoy, pensándote', 'Eres lo más lindo de mi día', 'Te mando un abrazo enorme 🤗', 'Mi corazón es tuyo ✨'],
    de: ['Ich denke an dich ❤️', 'Du bist mein Lieblingsmensch', 'Ich liebe dich so sehr', 'Ich habe an dich gedacht und gelächelt', 'Danke, dass es dich in meinem Leben gibt', 'Mit dir ist alles schöner 💕', 'Ich bin hier und denke an dich', 'Du bist das Schönste an meinem Tag', 'Ich schicke dir eine riesige Umarmung 🤗', 'Mein Herz gehört dir ✨'],
    en: ["I'm thinking of you ❤️", "You're my favourite person", 'I love you so much', 'I thought of you and smiled', 'Thank you for being in my life', 'Everything is more beautiful with you 💕', "I'm here, thinking of you", "You're the best part of my day", "I'm sending you a huge hug 🤗", 'My heart is yours ✨'],
    tr: ['Seni düşünüyorum ❤️', 'Sen benim en sevdiğim insansın', 'Seni çok seviyorum', 'Seni düşündüm ve gülümsedim', 'Hayatımda olduğun için teşekkürler', 'Seninle her şey daha güzel 💕', 'Buradayım, seni düşünüyorum', 'Günümün en güzel yanı sensin', 'Sana kocaman sarılıyorum 🤗', 'Kalbim senin ✨'],
    ru: ['Думаю о тебе ❤️', 'Ты мой самый любимый человек', 'Я очень тебя люблю', 'Ты заставляешь меня улыбаться', 'Спасибо, что ты есть в моей жизни', 'С тобой всё прекраснее 💕', 'Я здесь и думаю о тебе', 'Ты — лучшее в моём дне', 'Крепко-крепко обнимаю 🤗', 'Моё сердце принадлежит тебе ✨'],
    uk: ['Думаю про тебе ❤️', 'Ти моя найулюбленіша людина', 'Я дуже тебе кохаю', 'Ти змушуєш мене усміхатися', 'Дякую, що ти є в моєму житті', 'З тобою все прекрасніше 💕', 'Я тут і думаю про тебе', 'Ти — найкраще в моєму дні', 'Міцно-міцно обіймаю 🤗', 'Моє серце належить тобі ✨'],
    pl: ['Myślę o tobie ❤️', 'Jesteś moją ulubioną osobą', 'Bardzo cię kocham', 'Przez ciebie się uśmiecham', 'Dziękuję, że jesteś w moim życiu', 'Z tobą wszystko jest piękniejsze 💕', 'Jestem tu i myślę o tobie', 'Jesteś najpiękniejszą częścią mojego dnia', 'Przytulam cię mocno 🤗', 'Moje serce należy do ciebie ✨'],
    ar: ['أفكر فيك ❤️', 'أنت أحب الناس إلى قلبي', 'أحبك كثيرًا جدًا', 'فكرت فيك وابتسمت', 'شكرًا لأنك في حياتي', 'معك كل شيء أجمل 💕', 'أنا هنا وأفكر فيك', 'أنت أجمل ما في يومي', 'أرسل لك عناقًا كبيرًا 🤗', 'قلبي لك ✨'],
    fa: ['دارم بهت فکر می‌کنم ❤️', 'تو عزیزترین آدم زندگی منی', 'خیلی خیلی دوستت دارم', 'بهت فکر کردم و لبخند زدم', 'ممنونم که توی زندگیمی', 'با تو همه چیز قشنگ‌تره 💕', 'همین‌جام و به یادتم', 'تو قشنگ‌ترین بخش روز منی', 'یه بغل بزرگ برات می‌فرستم 🤗', 'دلم مال توئه ✨'],
    it: ['Ti sto pensando ❤️', 'Sei la mia persona preferita', 'Ti amo tantissimo', 'Ti ho pensato e ho sorriso', 'Grazie di esistere nella mia vita', 'Con te tutto è più bello 💕', 'Sono qui e ti penso', 'Sei la parte più bella della mia giornata', 'Ti mando un abbraccio enorme 🤗', 'Il mio cuore è tuo ✨'],
    ro: ['Mă gândesc la tine ❤️', 'Ești persoana mea preferată', 'Te iubesc enorm', 'M-am gândit la tine și am zâmbit', 'Mulțumesc că exiști în viața mea', 'Cu tine totul e mai frumos 💕', 'Sunt aici și mă gândesc la tine', 'Ești cea mai frumoasă parte a zilei mele', 'Îți trimit o îmbrățișare uriașă 🤗', 'Inima mea e a ta ✨'],
  };

  const S = {
    es: {
      tagline: 'Un toque para decir «te pienso».', askName: '¿Cómo te llamas?', namePh: 'Tu nombre', continue: 'Continuar',
      linkTitle: 'Vincúlense', linkSub: 'Uno crea el código y el otro lo escribe.', createCode: 'Crear código',
      waiting: 'Dale este código a tu pareja. Esta pantalla se actualiza sola cuando se una.', share: 'Compartir código',
      haveCode: '¿Ya tienes un código?', codePh: 'Código de 6 letras', join: 'Unirme',
      tabHome: 'Inicio', tabMsgs: 'Mensajes', youAnd: 'Tú y {p}', tapHint: 'Toca el corazón', sending: 'Enviando…', delivered: 'Le llegó: «{m}»',
      days: { one: 'día', other: 'días' }, streak: 'Racha', best: 'Récord: {n}', today: 'Hoy', you: 'Tú',
      streakHint: 'Para mantener la racha, los dos deben enviar al menos uno al día.',
      notifOn: '🔔 Notificaciones activadas', notifEnable: '🔔 Activar notificaciones para recibir su cariño',
      notifDenied: 'Permiso denegado. Actívalo en Ajustes › Notificaciones › Sahar.', notifUnsupported: 'Este navegador no admite notificaciones.',
      msgsTitle: 'Mensajes que pueden llegar', msgsSub: 'Cada toque envía uno al azar, sin repetir hasta usarlos todos.',
      newPh: 'Escribe uno nuevo…', add: 'Añadir', receivedTitle: 'Lo que has recibido', receivedEmpty: 'Aún no has recibido ninguno 💭',
      newLove: '{p} está pensando en ti', tapClose: 'Toca para cerrar',
      installTitle: 'Instala Sahar', installSub: 'Para recibir notificaciones en iPhone, primero añade la app a tu pantalla de inicio:',
      install1: 'Abre esta página en <b>Safari</b>.', install2: 'Toca <b>Compartir</b> (el cuadrado con la flecha).',
      install3: 'Elige <b>«Añadir a pantalla de inicio»</b>.', install4: 'Abre <b>Sahar</b> desde el nuevo ícono.',
      replyBack: "Devolverle el latido 💗", together: "{n} {days} juntos", since: "Juntos desde", sentLbl: "Enviados", recvLbl: "Recibidos", reminderPush: "🔥 ¡No pierdas la racha con {p}!", us: "Nosotros",
      holdHint: "Mantén presionado para enviarlo más fuerte", lvl1: "Suave 💗", lvl2: "Fuerte 💗💗", lvl3: "¡Con todo! 💗💗💗",
      waking: "Despertando a Sahar… 💗", retry: "Reintentar",
      streakPush: '🔥 ¡{n} {days} seguidos!',
      err: { invalid_date: 'Fecha no válida', unknown_user: 'Sesión no encontrada', code_not_found: 'Código no encontrado', couple_full: 'Esa pareja ya está completa', no_partner: 'Aún no tienes pareja vinculada', partner_no_notif: '{p} aún no activó las notificaciones', delivery_failed: 'No se pudo entregar la notificación', invalid_message: 'Mensaje inválido', min_one: 'Debe quedar al menos un mensaje', network: 'Sin conexión. Inténtalo de nuevo.' },
    },
    de: {
      tagline: 'Ein Tippen sagt: „Ich denk an dich.“', askName: 'Wie heißt du?', namePh: 'Dein Name', continue: 'Weiter',
      linkTitle: 'Verbindet euch', linkSub: 'Eine Person erstellt den Code, die andere gibt ihn ein.', createCode: 'Code erstellen',
      waiting: 'Gib diesen Code deinem Schatz. Der Bildschirm aktualisiert sich von selbst, sobald ihr verbunden seid.', share: 'Code teilen',
      haveCode: 'Du hast schon einen Code?', codePh: '6-stelliger Code', join: 'Verbinden',
      tabHome: 'Start', tabMsgs: 'Nachrichten', youAnd: 'Du & {p}', tapHint: 'Tippe auf das Herz', sending: 'Wird gesendet…', delivered: 'Angekommen: „{m}“',
      days: { one: 'Tag', other: 'Tage' }, streak: 'Serie', best: 'Rekord: {n}', today: 'Heute', you: 'Du',
      streakHint: 'Damit die Serie hält, müsst ihr beide jeden Tag mindestens einmal tippen.',
      notifOn: '🔔 Benachrichtigungen aktiv', notifEnable: '🔔 Benachrichtigungen aktivieren, um Liebe zu empfangen',
      notifDenied: 'Zugriff verweigert. Aktiviere es unter Einstellungen › Mitteilungen › Sahar.', notifUnsupported: 'Dieser Browser unterstützt keine Benachrichtigungen.',
      msgsTitle: 'Nachrichten, die ankommen können', msgsSub: 'Jedes Tippen schickt eine zufällige – ohne Wiederholung, bis alle durch sind.',
      newPh: 'Neue Nachricht schreiben…', add: 'Hinzufügen', receivedTitle: 'Was du bekommen hast', receivedEmpty: 'Noch nichts bekommen 💭',
      newLove: '{p} denkt an dich', tapClose: 'Tippen zum Schließen',
      installTitle: 'Sahar installieren', installSub: 'Damit Benachrichtigungen auf dem iPhone ankommen, füge die App zuerst zum Home-Bildschirm hinzu:',
      install1: 'Öffne diese Seite in <b>Safari</b>.', install2: 'Tippe auf <b>Teilen</b> (Quadrat mit Pfeil).',
      install3: 'Wähle <b>„Zum Home-Bildschirm“</b>.', install4: 'Öffne <b>Sahar</b> über das neue Symbol.',
      replyBack: "Herzschlag zurückschicken 💗", together: "{n} {days} zusammen", since: "Zusammen seit", sentLbl: "Gesendet", recvLbl: "Empfangen", reminderPush: "🔥 Verlier eure Serie mit {p} nicht!", us: "Wir",
      holdHint: "Gedrückt halten für mehr Stärke", lvl1: "Sanft 💗", lvl2: "Stark 💗💗", lvl3: "Mit voller Kraft! 💗💗💗",
      waking: "Sahar wacht auf… 💗", retry: "Erneut versuchen",
      streakPush: '🔥 {n} {days} in Folge!',
      err: { invalid_date: 'Ungültiges Datum', unknown_user: 'Sitzung nicht gefunden', code_not_found: 'Code nicht gefunden', couple_full: 'Dieses Paar ist schon vollständig', no_partner: 'Du bist noch mit niemandem verbunden', partner_no_notif: '{p} hat die Benachrichtigungen noch nicht aktiviert', delivery_failed: 'Benachrichtigung konnte nicht zugestellt werden', invalid_message: 'Ungültige Nachricht', min_one: 'Mindestens eine Nachricht muss bleiben', network: 'Keine Verbindung. Versuch es nochmal.' },
    },
    en: {
      tagline: 'One tap to say “I’m thinking of you.”', askName: "What's your name?", namePh: 'Your name', continue: 'Continue',
      linkTitle: 'Connect with your love', linkSub: 'One of you creates a code, the other enters it.', createCode: 'Create code',
      waiting: 'Share this code with your partner. This screen updates by itself once they join.', share: 'Share code',
      haveCode: 'Already have a code?', codePh: '6-letter code', join: 'Join',
      tabHome: 'Home', tabMsgs: 'Messages', youAnd: 'You & {p}', tapHint: 'Tap the heart', sending: 'Sending…', delivered: 'Delivered: “{m}”',
      days: { one: 'day', other: 'days' }, streak: 'Streak', best: 'Best: {n}', today: 'Today', you: 'You',
      streakHint: 'To keep your streak, you both need to send at least one a day.',
      notifOn: '🔔 Notifications on', notifEnable: '🔔 Turn on notifications to receive their love',
      notifDenied: 'Permission denied. Turn it on in Settings › Notifications › Sahar.', notifUnsupported: "This browser doesn't support notifications.",
      msgsTitle: 'Messages that can arrive', msgsSub: 'Each tap sends one at random — no repeats until all have been sent.',
      newPh: 'Write a new one…', add: 'Add', receivedTitle: "What you've received", receivedEmpty: 'Nothing yet 💭',
      newLove: '{p} is thinking of you', tapClose: 'Tap to close',
      installTitle: 'Install Sahar', installSub: 'To get notifications on iPhone, first add the app to your Home Screen:',
      install1: 'Open this page in <b>Safari</b>.', install2: 'Tap <b>Share</b> (the square with the arrow).',
      install3: 'Choose <b>“Add to Home Screen”</b>.', install4: 'Open <b>Sahar</b> from the new icon.',
      replyBack: "Send a heartbeat back 💗", together: "{n} {days} together", since: "Together since", sentLbl: "Sent", recvLbl: "Received", reminderPush: "🔥 Don't lose your streak with {p}!", us: "Us",
      holdHint: "Hold to send it stronger", lvl1: "Gentle 💗", lvl2: "Strong 💗💗", lvl3: "With all my heart! 💗💗💗",
      waking: "Waking up Sahar… 💗", retry: "Try again",
      streakPush: '🔥 {n} {days} in a row!',
      err: { invalid_date: 'Invalid date', unknown_user: 'Session not found', code_not_found: 'Code not found', couple_full: 'That couple is already complete', no_partner: "You're not connected to anyone yet", partner_no_notif: "{p} hasn't turned on notifications yet", delivery_failed: "The notification couldn't be delivered", invalid_message: 'Invalid message', min_one: 'At least one message must remain', network: 'No connection. Try again.' },
    },
    tr: {
      tagline: 'Tek dokunuşla “Seni düşünüyorum” de.', askName: 'Adın ne?', namePh: 'Adın', continue: 'Devam',
      linkTitle: 'Birbirinize bağlanın', linkSub: 'Biriniz kod oluşturur, diğeri girer.', createCode: 'Kod oluştur',
      waiting: 'Bu kodu sevgiline ver. O katıldığında bu ekran kendiliğinden güncellenir.', share: 'Kodu paylaş',
      haveCode: 'Kodun var mı?', codePh: '6 haneli kod', join: 'Katıl',
      tabHome: 'Ana sayfa', tabMsgs: 'Mesajlar', youAnd: 'Sen & {p}', tapHint: 'Kalbe dokun', sending: 'Gönderiliyor…', delivered: 'Ulaştı: “{m}”',
      days: { other: 'gün' }, streak: 'Seri', best: 'Rekor: {n}', today: 'Bugün', you: 'Sen',
      streakHint: 'Seriyi korumak için ikiniz de her gün en az bir tane göndermelisiniz.',
      notifOn: '🔔 Bildirimler açık', notifEnable: '🔔 Sevgisini almak için bildirimleri aç',
      notifDenied: 'İzin verilmedi. Ayarlar › Bildirimler › Sahar bölümünden aç.', notifUnsupported: 'Bu tarayıcı bildirimleri desteklemiyor.',
      msgsTitle: 'Gidebilecek mesajlar', msgsSub: 'Her dokunuş rastgele birini gönderir; hepsi bitene kadar tekrar yok.',
      newPh: 'Yeni bir tane yaz…', add: 'Ekle', receivedTitle: 'Sana gelenler', receivedEmpty: 'Henüz bir şey gelmedi 💭',
      newLove: '{p} seni düşünüyor', tapClose: 'Kapatmak için dokun',
      installTitle: 'Sahar’ı yükle', installSub: 'iPhone’da bildirim almak için önce uygulamayı ana ekrana ekle:',
      install1: 'Bu sayfayı <b>Safari</b>’de aç.', install2: '<b>Paylaş</b> düğmesine dokun (oklu kare).',
      install3: '<b>“Ana Ekrana Ekle”</b> seçeneğini seç.', install4: 'Yeni simgeden <b>Sahar</b>’ı aç.',
      replyBack: "Kalp atışını geri gönder 💗", together: "{n} {days} birlikte", since: "Birlikte olduğunuz ilk gün", sentLbl: "Gönderilen", recvLbl: "Gelen", reminderPush: "🔥 {p} ile serini kaybetme!", us: "Biz",
      holdHint: "Daha güçlü göndermek için basılı tut", lvl1: "Hafif 💗", lvl2: "Güçlü 💗💗", lvl3: "Tüm kalbimle! 💗💗💗",
      waking: "Sahar uyanıyor… 💗", retry: "Tekrar dene",
      streakPush: '🔥 Üst üste {n} {days}!',
      err: { invalid_date: 'Geçersiz tarih', unknown_user: 'Oturum bulunamadı', code_not_found: 'Kod bulunamadı', couple_full: 'Bu çift zaten tamam', no_partner: 'Henüz kimseyle bağlı değilsin', partner_no_notif: '{p} bildirimleri henüz açmadı', delivery_failed: 'Bildirim iletilemedi', invalid_message: 'Geçersiz mesaj', min_one: 'En az bir mesaj kalmalı', network: 'Bağlantı yok. Tekrar dene.' },
    },
    ru: {
      tagline: 'Одно касание, чтобы сказать «Я думаю о тебе».', askName: 'Как тебя зовут?', namePh: 'Твоё имя', continue: 'Дальше',
      linkTitle: 'Соединитесь', linkSub: 'Один создаёт код, другой его вводит.', createCode: 'Создать код',
      waiting: 'Отправь этот код любимому человеку. Экран обновится сам, когда он присоединится.', share: 'Поделиться кодом',
      haveCode: 'Уже есть код?', codePh: 'Код из 6 символов', join: 'Присоединиться',
      tabHome: 'Главная', tabMsgs: 'Сообщения', youAnd: 'Ты и {p}', tapHint: 'Нажми на сердце', sending: 'Отправляем…', delivered: 'Доставлено: «{m}»',
      days: { one: 'день', few: 'дня', many: 'дней', other: 'дня' }, streak: 'Серия', best: 'Рекорд: {n}', today: 'Сегодня', you: 'Ты',
      streakHint: 'Чтобы сохранить серию, вы оба должны отправлять хотя бы одно в день.',
      notifOn: '🔔 Уведомления включены', notifEnable: '🔔 Включи уведомления, чтобы получать любовь',
      notifDenied: 'Доступ запрещён. Включи в Настройки › Уведомления › Sahar.', notifUnsupported: 'Этот браузер не поддерживает уведомления.',
      msgsTitle: 'Сообщения, которые могут прийти', msgsSub: 'Каждое касание отправляет случайное — без повторов, пока не отправятся все.',
      newPh: 'Напиши новое…', add: 'Добавить', receivedTitle: 'Что тебе пришло', receivedEmpty: 'Пока ничего 💭',
      newLove: '{p} думает о тебе', tapClose: 'Нажми, чтобы закрыть',
      installTitle: 'Установить Sahar', installSub: 'Чтобы получать уведомления на iPhone, сначала добавь приложение на экран «Домой»:',
      install1: 'Открой эту страницу в <b>Safari</b>.', install2: 'Нажми <b>Поделиться</b> (квадрат со стрелкой).',
      install3: 'Выбери <b>«На экран „Домой“»</b>.', install4: 'Открой <b>Sahar</b> с новой иконки.',
      replyBack: "Ответить сердцем 💗", together: "{n} {days} вместе", since: "Вместе с", sentLbl: "Отправлено", recvLbl: "Получено", reminderPush: "🔥 Не потеряй серию с {p}!", us: "Мы",
      holdHint: "Удерживай, чтобы отправить сильнее", lvl1: "Нежно 💗", lvl2: "Сильно 💗💗", lvl3: "Всем сердцем! 💗💗💗",
      waking: "Sahar просыпается… 💗", retry: "Повторить",
      streakPush: '🔥 {n} {days} подряд!',
      err: { invalid_date: 'Неверная дата', unknown_user: 'Сессия не найдена', code_not_found: 'Код не найден', couple_full: 'Эта пара уже собрана', no_partner: 'Ты ещё ни с кем не связан(а)', partner_no_notif: '{p} ещё не включил(а) уведомления', delivery_failed: 'Не удалось доставить уведомление', invalid_message: 'Недопустимое сообщение', min_one: 'Должно остаться хотя бы одно сообщение', network: 'Нет соединения. Попробуй ещё раз.' },
    },
    uk: {
      tagline: 'Один дотик, щоб сказати «Я думаю про тебе».', askName: 'Як тебе звати?', namePh: "Твоє ім'я", continue: 'Далі',
      linkTitle: "Об'єднайтеся", linkSub: 'Один створює код, інший його вводить.', createCode: 'Створити код',
      waiting: 'Надішли цей код коханій людині. Екран оновиться сам, коли вона приєднається.', share: 'Поділитися кодом',
      haveCode: 'Вже маєш код?', codePh: 'Код із 6 символів', join: 'Приєднатися',
      tabHome: 'Головна', tabMsgs: 'Повідомлення', youAnd: 'Ти і {p}', tapHint: 'Торкнися серця', sending: 'Надсилаємо…', delivered: 'Доставлено: «{m}»',
      days: { one: 'день', few: 'дні', many: 'днів', other: 'дня' }, streak: 'Серія', best: 'Рекорд: {n}', today: 'Сьогодні', you: 'Ти',
      streakHint: 'Щоб зберегти серію, ви обоє маєте надсилати хоча б одне на день.',
      notifOn: '🔔 Сповіщення увімкнено', notifEnable: '🔔 Увімкни сповіщення, щоб отримувати любов',
      notifDenied: 'Доступ заборонено. Увімкни в Параметри › Сповіщення › Sahar.', notifUnsupported: 'Цей браузер не підтримує сповіщення.',
      msgsTitle: 'Повідомлення, які можуть прийти', msgsSub: 'Кожен дотик надсилає випадкове — без повторів, доки не надішлються всі.',
      newPh: 'Напиши нове…', add: 'Додати', receivedTitle: 'Що тобі прийшло', receivedEmpty: 'Поки нічого 💭',
      newLove: '{p} думає про тебе', tapClose: 'Торкнися, щоб закрити',
      installTitle: 'Встановити Sahar', installSub: 'Щоб отримувати сповіщення на iPhone, спершу додай застосунок на початковий екран:',
      install1: 'Відкрий цю сторінку в <b>Safari</b>.', install2: 'Торкнися <b>Поширити</b> (квадрат зі стрілкою).',
      install3: 'Вибери <b>«На початковий екран»</b>.', install4: 'Відкрий <b>Sahar</b> з нової іконки.',
      replyBack: "Відповісти серцем 💗", together: "{n} {days} разом", since: "Разом з", sentLbl: "Надіслано", recvLbl: "Отримано", reminderPush: "🔥 Не втрать серію з {p}!", us: "Ми",
      holdHint: "Утримуй, щоб надіслати сильніше", lvl1: "Ніжно 💗", lvl2: "Сильно 💗💗", lvl3: "Усім серцем! 💗💗💗",
      waking: "Sahar прокидається… 💗", retry: "Спробувати ще",
      streakPush: '🔥 {n} {days} поспіль!',
      err: { invalid_date: 'Неправильна дата', unknown_user: 'Сесію не знайдено', code_not_found: 'Код не знайдено', couple_full: 'Ця пара вже повна', no_partner: 'Ти ще ні з ким не з’єднаний(а)', partner_no_notif: '{p} ще не увімкнув(ла) сповіщення', delivery_failed: 'Не вдалося доставити сповіщення', invalid_message: 'Недійсне повідомлення', min_one: 'Має залишитися хоча б одне повідомлення', network: 'Немає з’єднання. Спробуй ще раз.' },
    },
    pl: {
      tagline: 'Jedno dotknięcie, by powiedzieć „Myślę o tobie”.', askName: 'Jak masz na imię?', namePh: 'Twoje imię', continue: 'Dalej',
      linkTitle: 'Połączcie się', linkSub: 'Jedno tworzy kod, drugie go wpisuje.', createCode: 'Utwórz kod',
      waiting: 'Przekaż ten kod ukochanej osobie. Ekran odświeży się sam, gdy dołączy.', share: 'Udostępnij kod',
      haveCode: 'Masz już kod?', codePh: 'Kod z 6 znaków', join: 'Dołącz',
      tabHome: 'Start', tabMsgs: 'Wiadomości', youAnd: 'Ty i {p}', tapHint: 'Dotknij serca', sending: 'Wysyłanie…', delivered: 'Dostarczono: „{m}”',
      days: { one: 'dzień', few: 'dni', many: 'dni', other: 'dnia' }, streak: 'Seria', best: 'Rekord: {n}', today: 'Dziś', you: 'Ty',
      streakHint: 'Aby utrzymać serię, oboje musicie wysłać co najmniej jedną dziennie.',
      notifOn: '🔔 Powiadomienia włączone', notifEnable: '🔔 Włącz powiadomienia, by otrzymywać miłość',
      notifDenied: 'Brak zgody. Włącz w Ustawienia › Powiadomienia › Sahar.', notifUnsupported: 'Ta przeglądarka nie obsługuje powiadomień.',
      msgsTitle: 'Wiadomości, które mogą dotrzeć', msgsSub: 'Każde dotknięcie wysyła losową — bez powtórzeń, dopóki nie wyślą się wszystkie.',
      newPh: 'Napisz nową…', add: 'Dodaj', receivedTitle: 'Co do ciebie dotarło', receivedEmpty: 'Jeszcze nic 💭',
      newLove: '{p} myśli o tobie', tapClose: 'Dotknij, aby zamknąć',
      installTitle: 'Zainstaluj Sahar', installSub: 'Aby otrzymywać powiadomienia na iPhonie, najpierw dodaj aplikację do ekranu początkowego:',
      install1: 'Otwórz tę stronę w <b>Safari</b>.', install2: 'Stuknij <b>Udostępnij</b> (kwadrat ze strzałką).',
      install3: 'Wybierz <b>„Do ekranu początkowego”</b>.', install4: 'Otwórz <b>Sahar</b> z nowej ikony.',
      replyBack: "Odpowiedz sercem 💗", together: "{n} {days} razem", since: "Razem od", sentLbl: "Wysłane", recvLbl: "Otrzymane", reminderPush: "🔥 Nie strać serii z {p}!", us: "My",
      holdHint: "Przytrzymaj, aby wysłać mocniej", lvl1: "Delikatnie 💗", lvl2: "Mocno 💗💗", lvl3: "Z całego serca! 💗💗💗",
      waking: "Sahar się budzi… 💗", retry: "Spróbuj ponownie",
      streakPush: '🔥 {n} {days} z rzędu!',
      err: { invalid_date: 'Nieprawidłowa data', unknown_user: 'Nie znaleziono sesji', code_not_found: 'Nie znaleziono kodu', couple_full: 'Ta para jest już pełna', no_partner: 'Nie masz jeszcze z nikim połączenia', partner_no_notif: '{p} nie włączył(a) jeszcze powiadomień', delivery_failed: 'Nie udało się dostarczyć powiadomienia', invalid_message: 'Nieprawidłowa wiadomość', min_one: 'Musi zostać co najmniej jedna wiadomość', network: 'Brak połączenia. Spróbuj ponownie.' },
    },
    ar: {
      tagline: 'لمسة واحدة لتقول «أفكر فيك».', askName: 'ما اسمك؟', namePh: 'اسمك', continue: 'متابعة',
      linkTitle: 'اربطا حسابيكما', linkSub: 'أحدكما ينشئ رمزًا والآخر يُدخله.', createCode: 'إنشاء رمز',
      waiting: 'أعطِ هذا الرمز لمن تحب. ستتحدّث هذه الشاشة تلقائيًا عند انضمامه.', share: 'مشاركة الرمز',
      haveCode: 'هل لديك رمز؟', codePh: 'رمز من ٦ أحرف', join: 'انضمام',
      tabHome: 'الرئيسية', tabMsgs: 'الرسائل', youAnd: 'أنت و{p}', tapHint: 'المس القلب', sending: 'جارٍ الإرسال…', delivered: 'وصلت: «{m}»',
      days: { zero: 'يوم', one: 'يوم', two: 'يومان', few: 'أيام', many: 'يومًا', other: 'يوم' }, streak: 'السلسلة', best: 'الأفضل: {n}', today: 'اليوم', you: 'أنت',
      streakHint: 'للحفاظ على السلسلة، يجب أن يرسل كلاكما رسالة واحدة على الأقل يوميًا.',
      notifOn: '🔔 الإشعارات مفعّلة', notifEnable: '🔔 فعّل الإشعارات لتصلك رسائل الحب',
      notifDenied: 'تم رفض الإذن. فعّله من الإعدادات › الإشعارات › Sahar.', notifUnsupported: 'هذا المتصفح لا يدعم الإشعارات.',
      msgsTitle: 'الرسائل التي قد تصل', msgsSub: 'كل لمسة ترسل رسالة عشوائية، دون تكرار حتى تُرسل جميعها.',
      newPh: 'اكتب رسالة جديدة…', add: 'إضافة', receivedTitle: 'ما وصلك', receivedEmpty: 'لا شيء بعد 💭',
      newLove: '{p} يفكر فيك', tapClose: 'المس للإغلاق',
      installTitle: 'ثبّت Sahar', installSub: 'لتصلك الإشعارات على iPhone، أضف التطبيق أولًا إلى الشاشة الرئيسية:',
      install1: 'افتح هذه الصفحة في <b>Safari</b>.', install2: 'اضغط <b>مشاركة</b> (المربع مع السهم).',
      install3: 'اختر <b>«إضافة إلى الشاشة الرئيسية»</b>.', install4: 'افتح <b>Sahar</b> من الأيقونة الجديدة.',
      replyBack: "ردّ بنبضة قلب 💗", together: "{n} {days} معًا", since: "معًا منذ", sentLbl: "أُرسلت", recvLbl: "وصلت", reminderPush: "🔥 لا تفقد سلسلتك مع {p}!", us: "نحن",
      holdHint: "اضغط مطولًا لترسلها بقوة أكبر", lvl1: "بلطف 💗", lvl2: "بقوة 💗💗", lvl3: "من كل قلبي! 💗💗💗",
      waking: "Sahar تستيقظ… 💗", retry: "إعادة المحاولة",
      streakPush: '🔥 {n} {days} على التوالي!',
      err: { invalid_date: 'تاريخ غير صالح', unknown_user: 'الجلسة غير موجودة', code_not_found: 'الرمز غير موجود', couple_full: 'هذا الثنائي مكتمل بالفعل', no_partner: 'لم ترتبط بأحد بعد', partner_no_notif: '{p} لم يفعّل الإشعارات بعد', delivery_failed: 'تعذّر إيصال الإشعار', invalid_message: 'رسالة غير صالحة', min_one: 'يجب أن تبقى رسالة واحدة على الأقل', network: 'لا يوجد اتصال. حاول مرة أخرى.' },
    },
    fa: {
      tagline: 'یک لمس، یعنی «به یادتم».', askName: 'اسمت چیه؟', namePh: 'اسم تو', continue: 'ادامه',
      linkTitle: 'به هم وصل شوید', linkSub: 'یکی کد می‌سازد و دیگری آن را وارد می‌کند.', createCode: 'ساختن کد',
      waiting: 'این کد را به عشقت بده. وقتی وصل شد، این صفحه خودش به‌روز می‌شود.', share: 'اشتراک‌گذاری کد',
      haveCode: 'کد داری؟', codePh: 'کد ۶ حرفی', join: 'وصل شو',
      tabHome: 'خانه', tabMsgs: 'پیام‌ها', youAnd: 'تو و {p}', tapHint: 'روی قلب بزن', sending: 'در حال ارسال…', delivered: 'رسید: «{m}»',
      days: { other: 'روز' }, streak: 'پشت سر هم', best: 'بهترین: {n}', today: 'امروز', you: 'تو',
      streakHint: 'برای حفظ این رکورد، هر دو باید هر روز حداقل یک بار بفرستید.',
      notifOn: '🔔 اعلان‌ها فعال است', notifEnable: '🔔 اعلان‌ها را فعال کن تا عشقش به تو برسد',
      notifDenied: 'اجازه داده نشد. از تنظیمات › اعلان‌ها › Sahar فعالش کن.', notifUnsupported: 'این مرورگر از اعلان پشتیبانی نمی‌کند.',
      msgsTitle: 'پیام‌هایی که ممکن است برسد', msgsSub: 'هر لمس یک پیام تصادفی می‌فرستد، بدون تکرار تا همه فرستاده شوند.',
      newPh: 'یک پیام تازه بنویس…', add: 'افزودن', receivedTitle: 'پیام‌هایی که گرفتی', receivedEmpty: 'هنوز پیامی نگرفتی 💭',
      newLove: '{p} به یادته', tapClose: 'برای بستن لمس کن',
      installTitle: 'نصب Sahar', installSub: 'برای دریافت اعلان در آیفون، اول برنامه را به صفحه‌ی اصلی اضافه کن:',
      install1: 'این صفحه را در <b>Safari</b> باز کن.', install2: 'روی <b>Share</b> (مربع با فلش) بزن.',
      install3: 'گزینه‌ی <b>«Add to Home Screen»</b> را انتخاب کن.', install4: '<b>Sahar</b> را از آیکون جدید باز کن.',
      replyBack: "با یک تپش جوابش را بده 💗", together: "{n} {days} با هم", since: "با هم از", sentLbl: "فرستاده", recvLbl: "دریافتی", reminderPush: "🔥 رکوردت با {p} را از دست نده!", us: "ما",
      holdHint: "نگه دار تا محکم‌تر بفرستی", lvl1: "آرام 💗", lvl2: "محکم 💗💗", lvl3: "با تمام وجود! 💗💗💗",
      waking: "Sahar داره بیدار می‌شه… 💗", retry: "دوباره امتحان کن",
      streakPush: '🔥 {n} {days} پشت سر هم!',
      err: { invalid_date: 'تاریخ نامعتبر', unknown_user: 'نشست پیدا نشد', code_not_found: 'کد پیدا نشد', couple_full: 'این زوج کامل است', no_partner: 'هنوز به کسی وصل نشده‌ای', partner_no_notif: '{p} هنوز اعلان‌ها را فعال نکرده', delivery_failed: 'اعلان ارسال نشد', invalid_message: 'پیام نامعتبر', min_one: 'حداقل یک پیام باید بماند', network: 'اتصال برقرار نیست. دوباره امتحان کن.' },
    },
    it: {
      tagline: 'Un tocco per dire “Ti penso”.', askName: 'Come ti chiami?', namePh: 'Il tuo nome', continue: 'Continua',
      linkTitle: 'Collegatevi', linkSub: 'Uno crea il codice, l’altro lo inserisce.', createCode: 'Crea codice',
      waiting: 'Dai questo codice alla persona che ami. Questa schermata si aggiorna da sola quando si unisce.', share: 'Condividi codice',
      haveCode: 'Hai già un codice?', codePh: 'Codice di 6 caratteri', join: 'Unisciti',
      tabHome: 'Home', tabMsgs: 'Messaggi', youAnd: 'Tu e {p}', tapHint: 'Tocca il cuore', sending: 'Invio…', delivered: 'Arrivato: “{m}”',
      days: { one: 'giorno', other: 'giorni' }, streak: 'Serie', best: 'Record: {n}', today: 'Oggi', you: 'Tu',
      streakHint: 'Per mantenere la serie, dovete inviarne almeno uno al giorno entrambi.',
      notifOn: '🔔 Notifiche attive', notifEnable: '🔔 Attiva le notifiche per ricevere il suo amore',
      notifDenied: 'Permesso negato. Attivalo in Impostazioni › Notifiche › Sahar.', notifUnsupported: 'Questo browser non supporta le notifiche.',
      msgsTitle: 'Messaggi che possono arrivare', msgsSub: 'Ogni tocco ne invia uno a caso, senza ripetizioni finché non sono stati inviati tutti.',
      newPh: 'Scrivine uno nuovo…', add: 'Aggiungi', receivedTitle: 'Cosa hai ricevuto', receivedEmpty: 'Ancora niente 💭',
      newLove: '{p} ti sta pensando', tapClose: 'Tocca per chiudere',
      installTitle: 'Installa Sahar', installSub: 'Per ricevere le notifiche su iPhone, aggiungi prima l’app alla schermata Home:',
      install1: 'Apri questa pagina in <b>Safari</b>.', install2: 'Tocca <b>Condividi</b> (il quadrato con la freccia).',
      install3: 'Scegli <b>“Aggiungi alla schermata Home”</b>.', install4: 'Apri <b>Sahar</b> dalla nuova icona.',
      replyBack: "Rispondi con un battito 💗", together: "{n} {days} insieme", since: "Insieme dal", sentLbl: "Inviati", recvLbl: "Ricevuti", reminderPush: "🔥 Non perdere la serie con {p}!", us: "Noi",
      holdHint: "Tieni premuto per inviarlo più forte", lvl1: "Dolce 💗", lvl2: "Forte 💗💗", lvl3: "Con tutto il cuore! 💗💗💗",
      waking: "Sahar si sta svegliando… 💗", retry: "Riprova",
      streakPush: '🔥 {n} {days} di fila!',
      err: { invalid_date: 'Data non valida', unknown_user: 'Sessione non trovata', code_not_found: 'Codice non trovato', couple_full: 'Questa coppia è già completa', no_partner: 'Non sei ancora collegato/a a nessuno', partner_no_notif: '{p} non ha ancora attivato le notifiche', delivery_failed: 'Impossibile consegnare la notifica', invalid_message: 'Messaggio non valido', min_one: 'Deve restare almeno un messaggio', network: 'Nessuna connessione. Riprova.' },
    },
    ro: {
      tagline: 'O atingere ca să spui „Mă gândesc la tine”.', askName: 'Cum te numești?', namePh: 'Numele tău', continue: 'Continuă',
      linkTitle: 'Conectați-vă', linkSub: 'Unul creează codul, celălalt îl introduce.', createCode: 'Creează cod',
      waiting: 'Dă acest cod persoanei iubite. Ecranul se actualizează singur când se alătură.', share: 'Distribuie codul',
      haveCode: 'Ai deja un cod?', codePh: 'Cod din 6 caractere', join: 'Alătură-te',
      tabHome: 'Acasă', tabMsgs: 'Mesaje', youAnd: 'Tu și {p}', tapHint: 'Atinge inima', sending: 'Se trimite…', delivered: 'A ajuns: „{m}”',
      days: { one: 'zi', few: 'zile', other: 'de zile' }, streak: 'Serie', best: 'Record: {n}', today: 'Azi', you: 'Tu',
      streakHint: 'Ca să păstrați seria, trebuie să trimiteți amândoi cel puțin unul pe zi.',
      notifOn: '🔔 Notificări activate', notifEnable: '🔔 Activează notificările ca să-i primești dragostea',
      notifDenied: 'Permisiune refuzată. Activeaz-o în Configurări › Notificări › Sahar.', notifUnsupported: 'Acest browser nu acceptă notificări.',
      msgsTitle: 'Mesaje care pot ajunge', msgsSub: 'Fiecare atingere trimite unul la întâmplare, fără repetări până nu se trimit toate.',
      newPh: 'Scrie unul nou…', add: 'Adaugă', receivedTitle: 'Ce ai primit', receivedEmpty: 'Nimic încă 💭',
      newLove: '{p} se gândește la tine', tapClose: 'Atinge pentru a închide',
      installTitle: 'Instalează Sahar', installSub: 'Ca să primești notificări pe iPhone, adaugă mai întâi aplicația pe ecranul principal:',
      install1: 'Deschide această pagină în <b>Safari</b>.', install2: 'Atinge <b>Partajează</b> (pătratul cu săgeată).',
      install3: 'Alege <b>„Adaugă pe ecranul principal”</b>.', install4: 'Deschide <b>Sahar</b> din noua pictogramă.',
      replyBack: "Răspunde cu o bătaie de inimă 💗", together: "{n} {days} împreună", since: "Împreună din", sentLbl: "Trimise", recvLbl: "Primite", reminderPush: "🔥 Nu pierde seria cu {p}!", us: "Noi",
      holdHint: "Ține apăsat ca să-l trimiți mai puternic", lvl1: "Blând 💗", lvl2: "Puternic 💗💗", lvl3: "Din toată inima! 💗💗💗",
      waking: "Sahar se trezește… 💗", retry: "Încearcă din nou",
      streakPush: '🔥 {n} {days} la rând!',
      err: { invalid_date: 'Dată invalidă', unknown_user: 'Sesiune negăsită', code_not_found: 'Cod negăsit', couple_full: 'Acest cuplu este deja complet', no_partner: 'Nu ești încă conectat(ă) cu nimeni', partner_no_notif: '{p} nu a activat încă notificările', delivery_failed: 'Notificarea nu a putut fi livrată', invalid_message: 'Mesaj invalid', min_one: 'Trebuie să rămână cel puțin un mesaj', network: 'Fără conexiune. Încearcă din nou.' },
    },
  };

  const LANGS = Object.keys(LANG_NAMES);

  function pick(lang) { return LANGS.includes(lang) ? lang : 'en'; }
  function fmtNum(lang, n) { return new Intl.NumberFormat(LOCALES[pick(lang)]).format(n); }
  function plural(lang, n, forms) {
    const cat = new Intl.PluralRules(LOCALES[pick(lang)]).select(n);
    return forms[cat] || forms.other;
  }
  function fill(str, vars) { return String(str).replace(/\{(\w+)\}/g, (_, k) => (vars && vars[k] != null ? vars[k] : '')); }
  function t(lang, key, vars) {
    const l = pick(lang);
    const path = key.split('.');
    let v = S[l], fb = S.en;
    for (const p of path) { v = v && v[p]; fb = fb && fb[p]; }
    return fill(v != null ? v : (fb != null ? fb : key), vars);
  }
  function localizeMessage(msg, lang) {
    const m = /^@(\d+)$/.exec(msg || '');
    if (!m) return msg;
    const arr = MESSAGES[pick(lang)];
    return arr[Number(m[1])] || msg;
  }
  function streakPush(lang, n) {
    const l = pick(lang);
    return fill(S[l].streakPush, { n: fmtNum(l, n), days: plural(l, n, S[l].days) });
  }
  function detect(list) {
    for (const raw of list || []) {
      const code = String(raw).toLowerCase().split('-')[0];
      if (LANGS.includes(code)) return code;
    }
    return 'de';
  }

  const api = { LANGS, LANG_NAMES, RTL, LOCALES, MESSAGES, STRINGS: S, t, plural, fmtNum, localizeMessage, streakPush, detect, pick };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SaharI18n = api;
})(typeof self !== 'undefined' ? self : this);
