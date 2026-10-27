/* Beispiel: Achievement freischalten bzw. Fortschritt melden.
 *   ./example unlock FIRST_STEP
 *   ./example progress COLLECTOR 7
 *   ./example list
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "gameserver_sdk.h"

int main(int argc, char **argv) {
    gs_sdk *sdk = gs_sdk_from_env();
    if (!sdk) {
        fprintf(stderr, "GS_API_URL und GS_GAME_TOKEN fehlen (Spiel über den Desktop-Client starten)\n");
        return 2;
    }
    int rc = 0;
    gs_unlock_info info;
    if (argc >= 3 && strcmp(argv[1], "unlock") == 0) {
        gs_result r = gs_sdk_unlock(sdk, argv[2], &info);
        printf("result=%d newly=%d unlocked=%d status=%ld\n", r, info.newly_unlocked, info.unlocked, info.http_status);
        if (r == GS_ERROR) fprintf(stderr, "%s\n", gs_sdk_last_error(sdk));
        rc = r == GS_OK ? 0 : 1;
    } else if (argc >= 4 && strcmp(argv[1], "progress") == 0) {
        gs_result r = gs_sdk_set_progress(sdk, argv[2], strtol(argv[3], NULL, 10), &info);
        printf("result=%d newly=%d unlocked=%d progress=%ld\n", r, info.newly_unlocked, info.unlocked, info.progress);
        rc = r == GS_OK ? 0 : 1;
    } else {
        char *json = gs_sdk_achievements_json(sdk);
        if (json) {
            puts(json);
            free(json);
        } else {
            rc = 1;
        }
    }
    gs_sdk_free(sdk);
    return rc;
}
