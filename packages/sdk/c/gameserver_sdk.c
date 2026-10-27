/* Game-Server-SDK für C/C++ (MIT-Lizenz) – siehe gameserver_sdk.h */
#include "gameserver_sdk.h"

#include <curl/curl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define GS_MAX_PENDING 64

typedef struct {
    char *api_name;
    long progress; /* -1 = einfache Freischaltung */
} gs_pending;

struct gs_sdk {
    char *api_url;
    char *token;
    char *game_id;
    gs_pending pending[GS_MAX_PENDING];
    int pending_count;
    char last_error[256];
};

typedef struct {
    char *data;
    size_t len;
} gs_buffer;

static char *gs_strdup(const char *s) {
    if (!s) return NULL;
    size_t n = strlen(s) + 1;
    char *c = malloc(n);
    if (c) memcpy(c, s, n);
    return c;
}

static size_t gs_write(char *ptr, size_t size, size_t nmemb, void *userdata) {
    gs_buffer *buf = userdata;
    size_t add = size * nmemb;
    char *next = realloc(buf->data, buf->len + add + 1);
    if (!next) return 0;
    buf->data = next;
    memcpy(buf->data + buf->len, ptr, add);
    buf->len += add;
    buf->data[buf->len] = '\0';
    return add;
}

/* Sehr kleiner JSON-Leser für flache Werte (reicht für die SDK-Antworten) */
static int gs_json_bool(const char *json, const char *key) {
    char pattern[64];
    snprintf(pattern, sizeof pattern, "\"%s\":", key);
    const char *p = json ? strstr(json, pattern) : NULL;
    return p && strncmp(p + strlen(pattern), "true", 4) == 0;
}

static long gs_json_long(const char *json, const char *key) {
    char pattern[64];
    snprintf(pattern, sizeof pattern, "\"%s\":", key);
    const char *p = json ? strstr(json, pattern) : NULL;
    return p ? strtol(p + strlen(pattern), NULL, 10) : 0;
}

static void gs_json_string(const char *json, const char *key, char *out, size_t out_len) {
    char pattern[64];
    snprintf(pattern, sizeof pattern, "\"%s\":\"", key);
    const char *p = json ? strstr(json, pattern) : NULL;
    out[0] = '\0';
    if (!p) return;
    p += strlen(pattern);
    size_t i = 0;
    while (*p && *p != '"' && i + 1 < out_len) out[i++] = *p++;
    out[i] = '\0';
}

/* Führt eine Anfrage aus. Rückgabe: HTTP-Status oder 0 bei Netzwerkfehler. */
static long gs_request(gs_sdk *sdk, const char *method, const char *path, const char *body, gs_buffer *out) {
    CURL *curl = curl_easy_init();
    if (!curl) return 0;
    char url[2048];
    snprintf(url, sizeof url, "%s/api/sdk%s", sdk->api_url, path);
    char auth[600];
    snprintf(auth, sizeof auth, "Authorization: Bearer %s", sdk->token);
    struct curl_slist *headers = curl_slist_append(NULL, auth);
    /* POST immer mit JSON-Körper senden (curl würde sonst form-urlencoded setzen) */
    if (!body && strcmp(method, "POST") == 0) body = "{}";
    if (body) headers = curl_slist_append(headers, "Content-Type: application/json");
    curl_easy_setopt(curl, CURLOPT_URL, url);
    curl_easy_setopt(curl, CURLOPT_CUSTOMREQUEST, method);
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 10L);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, gs_write);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, out);
    curl_easy_setopt(curl, CURLOPT_USERAGENT, "gameserver-sdk-c/0.4.0");
    if (body) curl_easy_setopt(curl, CURLOPT_POSTFIELDS, body);
    long status = 0;
    CURLcode rc = curl_easy_perform(curl);
    if (rc == CURLE_OK) curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &status);
    else snprintf(sdk->last_error, sizeof sdk->last_error, "%s", curl_easy_strerror(rc));
    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);
    return status;
}

gs_sdk *gs_sdk_new(const char *api_url, const char *token, const char *game_id) {
    if (!api_url || !token || !*api_url || !*token) return NULL;
    curl_global_init(CURL_GLOBAL_DEFAULT);
    gs_sdk *sdk = calloc(1, sizeof *sdk);
    if (!sdk) return NULL;
    sdk->api_url = gs_strdup(api_url);
    size_t n = strlen(sdk->api_url);
    while (n > 0 && sdk->api_url[n - 1] == '/') sdk->api_url[--n] = '\0';
    sdk->token = gs_strdup(token);
    sdk->game_id = gs_strdup(game_id);
    return sdk;
}

gs_sdk *gs_sdk_from_env(void) {
    return gs_sdk_new(getenv("GS_API_URL"), getenv("GS_GAME_TOKEN"), getenv("GS_GAME_ID"));
}

void gs_sdk_free(gs_sdk *sdk) {
    if (!sdk) return;
    for (int i = 0; i < sdk->pending_count; i++) free(sdk->pending[i].api_name);
    free(sdk->api_url);
    free(sdk->token);
    free(sdk->game_id);
    free(sdk);
    curl_global_cleanup();
}

static void gs_queue(gs_sdk *sdk, const char *api_name, long progress) {
    for (int i = 0; i < sdk->pending_count; i++) {
        if (strcmp(sdk->pending[i].api_name, api_name) == 0) {
            if (progress < 0) sdk->pending[i].progress = -1;
            else if (sdk->pending[i].progress >= 0 && progress > sdk->pending[i].progress) sdk->pending[i].progress = progress;
            return;
        }
    }
    if (sdk->pending_count >= GS_MAX_PENDING) return;
    sdk->pending[sdk->pending_count].api_name = gs_strdup(api_name);
    sdk->pending[sdk->pending_count].progress = progress;
    sdk->pending_count++;
}

static int gs_valid_name(const char *s) {
    if (!s || !*s || strlen(s) > 64) return 0;
    for (; *s; s++) {
        char c = *s;
        if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '.' || c == '-')) return 0;
    }
    return 1;
}

static gs_result gs_send(gs_sdk *sdk, const char *api_name, long progress, gs_unlock_info *info) {
    if (!sdk || !gs_valid_name(api_name)) return GS_INVALID_ARGUMENT;
    char path[256];
    char body[64];
    gs_buffer out = {0};
    long status;
    if (progress < 0) {
        snprintf(path, sizeof path, "/achievements/%s/unlock", api_name);
        status = gs_request(sdk, "POST", path, NULL, &out);
    } else {
        snprintf(path, sizeof path, "/achievements/%s/progress", api_name);
        snprintf(body, sizeof body, "{\"progress\":%ld}", progress);
        status = gs_request(sdk, "POST", path, body, &out);
    }
    if (info) {
        memset(info, 0, sizeof *info);
        info->http_status = status;
    }
    gs_result result;
    if (status >= 200 && status < 300) {
        if (info) {
            info->newly_unlocked = gs_json_bool(out.data, "newlyUnlocked");
            info->unlocked = gs_json_bool(out.data, "unlocked");
            info->progress = gs_json_long(out.data, "progress");
        }
        result = GS_OK;
    } else if (status == 0 || status == 429 || status >= 500) {
        gs_queue(sdk, api_name, progress);
        result = GS_QUEUED;
    } else {
        char msg[200];
        gs_json_string(out.data, "message", msg, sizeof msg);
        snprintf(sdk->last_error, sizeof sdk->last_error, "HTTP %ld: %s", status, msg);
        result = GS_ERROR;
    }
    free(out.data);
    return result;
}

gs_result gs_sdk_unlock(gs_sdk *sdk, const char *api_name, gs_unlock_info *info) {
    return gs_send(sdk, api_name, -1, info);
}

gs_result gs_sdk_set_progress(gs_sdk *sdk, const char *api_name, long progress, gs_unlock_info *info) {
    if (progress < 0) progress = 0;
    return gs_send(sdk, api_name, progress, info);
}

int gs_sdk_pending_count(const gs_sdk *sdk) {
    return sdk ? sdk->pending_count : 0;
}

int gs_sdk_flush(gs_sdk *sdk) {
    if (!sdk) return 0;
    gs_pending queue[GS_MAX_PENDING];
    int count = sdk->pending_count;
    memcpy(queue, sdk->pending, sizeof(gs_pending) * (size_t)count);
    sdk->pending_count = 0;
    int sent = 0;
    for (int i = 0; i < count; i++) {
        if (gs_send(sdk, queue[i].api_name, queue[i].progress, NULL) == GS_OK) sent++;
        free(queue[i].api_name);
    }
    return sent;
}

char *gs_sdk_achievements_json(gs_sdk *sdk) {
    if (!sdk) return NULL;
    gs_buffer out = {0};
    long status = gs_request(sdk, "GET", "/achievements", NULL, &out);
    if (status != 200) {
        free(out.data);
        return NULL;
    }
    return out.data;
}

const char *gs_sdk_last_error(const gs_sdk *sdk) {
    return sdk ? sdk->last_error : "";
}
