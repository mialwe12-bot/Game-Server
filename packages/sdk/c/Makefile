# Game-Server-SDK (C) – Beispiel bauen: make
CFLAGS ?= -O2 -Wall -Wextra -std=c99
LDLIBS = -lcurl

all: example libgameserver_sdk.a

gameserver_sdk.o: gameserver_sdk.c gameserver_sdk.h
	$(CC) $(CFLAGS) -c gameserver_sdk.c -o $@

libgameserver_sdk.a: gameserver_sdk.o
	$(AR) rcs $@ $^

example: example.c gameserver_sdk.o
	$(CC) $(CFLAGS) example.c gameserver_sdk.o -o $@ $(LDLIBS)

clean:
	rm -f *.o *.a example

.PHONY: all clean
