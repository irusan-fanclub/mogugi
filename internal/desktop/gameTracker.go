package desktop

import (
	"runtime"
		"sync"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

// The game runs elevated while mogugi does not; out-of-context WinEvents still
// reach an unelevated process, so the game window is tracked through them.

var (
	gtUser32            = windows.NewLazySystemDLL("user32.dll")
	gtSetWinEventHook   = gtUser32.NewProc("SetWinEventHook")
	gtUnhookWinEvent    = gtUser32.NewProc("UnhookWinEvent")
	gtEnumWindows       = gtUser32.NewProc("EnumWindows")
	gtGetClassName      = gtUser32.NewProc("GetClassNameW")
	gtIsWindow          = gtUser32.NewProc("IsWindow")
	gtIsWindowVisible   = gtUser32.NewProc("IsWindowVisible")
	gtIsIconic          = gtUser32.NewProc("IsIconic")
	gtGetClientRect     = gtUser32.NewProc("GetClientRect")
	gtClientToScreen    = gtUser32.NewProc("ClientToScreen")
	gtPeekMessage       = gtUser32.NewProc("PeekMessageW")
	gtDispatchMessage   = gtUser32.NewProc("DispatchMessageW")
	gtMsgWaitForObjects = gtUser32.NewProc("MsgWaitForMultipleObjects")
)

const (
	evSystemForeground    = 0x0003
	evSystemMoveSizeEnd   = 0x000B
	evSystemMinimizeStart = 0x0016
	evSystemMinimizeEnd   = 0x0017
	evObjectLocationChg   = 0x800B
	winEventOutOfContext  = 0
	objIDWindow           = 0
	pmRemove              = 1
	qsAllInput            = 0x04FF

	gameClass       = "Mabinogi"
	gameFlushGap    = 25 * time.Millisecond
	gameFindEvery   = time.Second
	gamePollEvery   = time.Second
	gameTrackerWake = 10 * time.Millisecond
)

type gtPoint struct{ X, Y int32 }
type gtRect struct{ L, T, R, B int32 }

// startGameTracker follows the game window on its own thread and reports
// coalesced state through onState; onForeground fires when the game window
// becomes the foreground window. stop ends the thread.
func startGameTracker(onState func(gameState), onForeground func()) (stop func()) {
	ready := make(chan uint32, 1)
	done := make(chan struct{})
	go func() {
		defer close(done)
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()
		var msg [48]byte
		gtPeekMessage.Call(uintptr(unsafe.Pointer(&msg[0])), 0, 0, 0, 0) // creates the thread's message queue
		ready <- windows.GetCurrentThreadId()
		runGameTracker(onState, onForeground)
	}()
	thread := <-ready
	var once sync.Once
	return func() {
		once.Do(func() {
			hkPostThreadMsg.Call(uintptr(thread), wmQuit, 0, 0)
			<-done
		})
	}
}

func runGameTracker(onState func(gameState), onForeground func()) {
	core := newGameTrackerCore(onState, gameFlushGap, time.Now)
	var (
		game  uintptr
		pid   uint32
		hooks []uintptr
	)

	observe := func() {
		if game == 0 {
			return
		}
		core.Observe(readGame(game))
	}
	unhook := func() {
		for _, h := range hooks {
			gtUnhookWinEvent.Call(h)
		}
		hooks = nil
	}
	defer unhook()

	callback := syscall.NewCallback(func(hook, event, hwnd, objID, childID, thread, ts uintptr) uintptr {
		if game == 0 {
			return 0
		}
		switch uint32(event) {
		case evObjectLocationChg:
			if hwnd != game || int32(objID) != objIDWindow {
				return 0
			}
		case evSystemForeground:
			if hwnd == game {
				onForeground()
			}
		}
		observe()
		return 0
	})
	install := func() {
		for _, r := range [][2]uintptr{
			{evSystemForeground, evSystemForeground},
			{evSystemMoveSizeEnd, evSystemMoveSizeEnd},
			{evSystemMinimizeStart, evSystemMinimizeEnd},
		} {
			if h, _, _ := gtSetWinEventHook.Call(r[0], r[1], 0, callback, 0, 0, winEventOutOfContext); h != 0 {
				hooks = append(hooks, h)
			}
		}
		if h, _, _ := gtSetWinEventHook.Call(evObjectLocationChg, evObjectLocationChg, 0, callback, uintptr(pid), 0, winEventOutOfContext); h != 0 {
			hooks = append(hooks, h)
		}
	}

	var nextFind, nextPoll time.Time
	var msg [48]byte
	for {
		for {
			r, _, _ := gtPeekMessage.Call(uintptr(unsafe.Pointer(&msg[0])), 0, 0, 0, pmRemove)
			if r == 0 {
				break
			}
			if *(*uint32)(unsafe.Pointer(&msg[8])) == wmQuit { // MSG.message
				return
			}
			gtDispatchMessage.Call(uintptr(unsafe.Pointer(&msg[0])))
		}

		now := time.Now()
		if game == 0 {
			if !now.Before(nextFind) {
				nextFind = now.Add(gameFindEvery)
				if game = findGameWindow(); game != 0 {
					pid = windowProcessID(game)
					install()
					observe()
					nextPoll = now.Add(gamePollEvery)
				}
			}
		} else if !now.Before(nextPoll) {
			nextPoll = now.Add(gamePollEvery)
			if alive, _, _ := gtIsWindow.Call(game); alive == 0 {
				unhook()
				core.Observe(gameObs{HWND: game})
				game = 0
				nextFind = now
			} else {
				observe()
			}
		}
		core.Flush()

		wait := gameTrackerWake
		if !core.Pending() {
			next := nextFind
			if game != 0 {
				next = nextPoll
			}
			wait = max(time.Until(next), gameTrackerWake)
		}
		gtMsgWaitForObjects.Call(0, 0, 0, uintptr(wait/time.Millisecond), qsAllInput)
	}
}

func readGame(h uintptr) gameObs {
	alive, _, _ := gtIsWindow.Call(h)
	if alive == 0 {
		return gameObs{HWND: h}
	}
	iconic, _, _ := gtIsIconic.Call(h)
	var r gtRect
	var p gtPoint
	gtGetClientRect.Call(h, uintptr(unsafe.Pointer(&r)))
	gtClientToScreen.Call(h, uintptr(unsafe.Pointer(&p)))
	return gameObs{
		HWND: h, Alive: true, Iconic: iconic != 0,
		Client: rect{X: int(p.X), Y: int(p.Y), W: int(r.R - r.L), H: int(r.B - r.T)},
	}
}

// enumGame is the single EnumWindows callback; the runtime never frees
// callback slots, so it is created once and fed through the enum* variables.
var (
	enumMu    sync.Mutex
	enumFound uintptr
	enumOnce  sync.Once
	enumCb    uintptr
)

func enumGameWindow(h, _ uintptr) uintptr {
	if vis, _, _ := gtIsWindowVisible.Call(h); vis == 0 {
		return 1
	}
	var buf [64]uint16
	gtGetClassName.Call(h, uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
	if windows.UTF16ToString(buf[:]) != gameClass {
		return 1
	}
	enumFound = h
	return 0
}

func windowProcessID(h uintptr) uint32 {
	var pid uint32
	windows.GetWindowThreadProcessId(windows.HWND(h), &pid)
	return pid
}

// findGameWindow returns the first visible window of class gameClass.
func findGameWindow() uintptr {
	enumOnce.Do(func() { enumCb = syscall.NewCallback(enumGameWindow) })
	enumMu.Lock()
	defer enumMu.Unlock()
	enumFound = 0
	gtEnumWindows.Call(enumCb, 0)
	return enumFound
}
