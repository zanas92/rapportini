// Caricato nell'<head>, prima che la pagina venga disegnata: se c'è un PIN,
// nasconde subito i dati. Sta in un file a parte perché la Content-Security-Policy
// di index.html non permette script scritti dentro la pagina.
try { if (localStorage.getItem('rapportini.pin')) document.documentElement.classList.add('locked'); } catch (e) {}
