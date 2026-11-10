# 題名が「メモ帳」の窓へ、窓管理からの「閉じる」要求(WM_DELETE_WINDOW)を送る。端から端までの試験用(Linux/X11)。
import sys
from Xlib import display, X, protocol
d = display.Display()
root = d.screen().root
NET_WM_NAME = d.intern_atom("_NET_WM_NAME"); UTF8 = d.intern_atom("UTF8_STRING")
WM_PROTOCOLS = d.intern_atom("WM_PROTOCOLS"); WM_DELETE = d.intern_atom("WM_DELETE_WINDOW")
title = sys.argv[1] if len(sys.argv) > 1 else "メモ帳"
sent = 0
def walk(w):
    global sent
    try:
        p = w.get_full_property(NET_WM_NAME, UTF8)
        name = p.value.decode("utf-8") if p else None
    except Exception:
        name = None
    if name == title:
        ev = protocol.event.ClientMessage(window=w, client_type=WM_PROTOCOLS, data=(32, [WM_DELETE, X.CurrentTime, 0, 0, 0]))
        w.send_event(ev, event_mask=X.NoEventMask); sent += 1
    for c in w.query_tree().children:
        walk(c)
walk(root); d.flush()
print(sent)
