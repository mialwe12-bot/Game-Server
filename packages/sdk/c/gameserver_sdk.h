/*
 * Game-Server-SDK für C/C++ (MIT-Lizenz) – Achievements aus dem Spiel heraus freischalten.
 *
 * Abhängigkeit: libcurl. Beispiel:
 *
 *     gs_sdk *sdk = gs_sdk_from_env();          // NULL, wenn nicht über den Desktop-Client gestartet
 *     if (sdk) {
 *         gs_sdk_unlock(sdk, "FIRST_BLOOD", NULL);
 *         gs_sdk_set_progress(sdk, "COLLECTOR", 7, NULL);
 *         gs_sdk_free(sdk);
 *     }
 *
 * Alle Funktionen sind blockierend; rufe sie aus einem eigenen Thread auf, wenn das Spiel nicht stocken soll.
 * Fehlgeschlagene Meldungen (Netzwerk) werden vorgemerkt und mit gs_sdk_flush() nachgeholt.
 */
#ifndef GAMESERVER_SDK_H
#define GAMESERVER_SDK_H

#ifdef __cplusplus
extern "C" {
#endif

typedef struct gs_sdk gs_sdk;

typedef enum {
    GS_OK = 0,
    /** Netzwerkfehler – Meldung wurde vorgemerkt */
    GS_QUEUED = 1,
    /** Fachlicher Fehler (z. B. unbekanntes Achievement, Token ungültig) */
    GS_ERROR = -1,
    GS_INVALID_ARGUMENT = -2
} gs_result;

/** Ergebnis einer Freischaltung */
typedef struct {
    int newly_unlocked; /* 1 = durch diesen Aufruf freigeschaltet */
    int unlocked;       /* 1 = ist freigeschaltet */
    long progress;      /* aktueller Fortschritt */
    long http_status;   /* HTTP-Status der letzten Antwort (0 bei Netzwerkfehler) */
} gs_unlock_info;

/** SDK aus GS_API_URL / GS_GAME_TOKEN / GS_GAME_ID erzeugen (NULL, wenn sie fehlen). */
gs_sdk *gs_sdk_from_env(void);
/** SDK mit expliziten Werten erzeugen (game_id darf NULL sein). */
gs_sdk *gs_sdk_new(const char *api_url, const char *token, const char *game_id);
void gs_sdk_free(gs_sdk *sdk);

gs_result gs_sdk_unlock(gs_sdk *sdk, const char *api_name, gs_unlock_info *info);
gs_result gs_sdk_set_progress(gs_sdk *sdk, const char *api_name, long progress, gs_unlock_info *info);

/** Vorgemerkte Meldungen senden; liefert die Anzahl erfolgreicher Übertragungen. */
int gs_sdk_flush(gs_sdk *sdk);
int gs_sdk_pending_count(const gs_sdk *sdk);

/**
 * Rohes JSON aller Achievements (Liste) abrufen. Der Aufrufer gibt den String mit free() frei.
 * Liefert NULL bei Fehlern.
 */
char *gs_sdk_achievements_json(gs_sdk *sdk);

/** Fehlermeldung der letzten fehlgeschlagenen Anfrage (gehört dem SDK) */
const char *gs_sdk_last_error(const gs_sdk *sdk);

#ifdef __cplusplus
}
#endif

#endif /* GAMESERVER_SDK_H */
