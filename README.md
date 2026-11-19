# Il Grimorio delle Voci

Modificatore di voce nel browser per giochi di ruolo: scegli un'entità (orco, demone, drago antico, lich, fata…), regola tono e risonanza e registra le tue battute.

**Prova online:** https://youssefcherkaoui.github.io/cambia-voce/

![Il Grimorio delle Voci](https://raw.githubusercontent.com/YoussefCherkaoui/portfolio/main/img/cambia-voce.jpg)

## Cosa fa

- Dieci voci predefinite e voci personalizzate salvate nel browser (`localStorage`)
- Due modalità: *Tieni e parla*, più sicura, e *Incanto continuo*, da usare con le cuffie
- Oscilloscopio e misuratore di livello dal vivo
- Registrazione con `MediaRecorder` e download delle battute

## Tecnologie

HTML, CSS e JavaScript senza librerie: Web Audio API (filtri biquad, modulazione), `getUserMedia`, Canvas.

## Avvio in locale

Il microfono funziona solo in un contesto sicuro (HTTPS o `localhost`):

```bash
python3 -m http.server 8000
```

poi apri http://localhost:8000.
