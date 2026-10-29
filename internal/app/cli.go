package app

import (
	"fmt"
	"io"
	"runtime/debug"

	"github.com/irusan-fanclub/mogugi/lib/util"
)

type CLIAction int

const (
	CLIRun CLIAction = iota
	CLIHelp
	CLIVersion
)

// ParseCLI maps args (without the program name) to an action. Anything but
// no args, -h/--help or --version is an error.
func ParseCLI(args []string) (CLIAction, error) {
	if len(args) == 0 {
		return CLIRun, nil
	}
	if len(args) == 1 {
		switch args[0] {
		case "-h", "--help":
			return CLIHelp, nil
		case "--version":
			return CLIVersion, nil
		}
	}
	return 0, fmt.Errorf("未知的參數 %q", args[0])
}

// UsageText is the exe's built-in documentation.
func UsageText() string {
	return fmt.Sprintf(`mogugi v%s — 瑪奇傷害計量器

用法：
  mogugi              即時擷取（自動偵測遊戲連線）
  mogugi -h, --help   顯示本說明
  mogugi --version    顯示版本

環境變數：
  MOGUGI_DATA_DIR     資料目錄（預設為 mogugi.exe 所在目錄），
                      存放 logs、items_log、license.dat、mogugi-config.toml
`, Version)
}

// Startup parses args and, only when the run should proceed, opens the log
// file, loads the config and opens items.db. Help, version and errors print
// to out and create no files.
func Startup(args []string, out io.Writer) (proceed bool, exitCode int) {
	if proceed, exitCode = ParseStartup(args, out); !proceed {
		return
	}
	InitRuntime()
	return true, 0
}

// ParseStartup is Startup's CLI stage: it creates no files.
func ParseStartup(args []string, out io.Writer) (proceed bool, exitCode int) {
	act, err := ParseCLI(args)
	if err != nil {
		fmt.Fprintf(out, "%v\n\n%s", err, UsageText())
		return false, 2
	}
	switch act {
	case CLIHelp:
		fmt.Fprint(out, UsageText())
		return false, 0
	case CLIVersion:
		fmt.Fprintf(out, "mogugi v%s\n", Version)
		return false, 0
	}
	return true, 0
}

// ParseStartupLenient is ParseStartup for the desktop exe: Windows toast
// activation launches it with arbitrary arguments, so unknown ones are
// returned in ignored (to log) instead of failing.
func ParseStartupLenient(args []string, out io.Writer) (proceed bool, exitCode int, ignored []string) {
	if _, err := ParseCLI(args); err != nil {
		return true, 0, args
	}
	proceed, exitCode = ParseStartup(args, out)
	return proceed, exitCode, nil
}

// InitRuntime opens the log file, loads the config and opens items.db.
func InitRuntime() {
	logFilePath := DataPath("logs", fmt.Sprintf("mogugi_%s.log", util.StartStamp))
	if err := util.LogInit(logFilePath); err != nil {
		logger.Println("LogInit failed:", err)
	}
	logger.Printf("log file: %s", logFilePath)
	// Route fatal runtime errors and goroutine panics into the log too.
	if f := util.LogFile(); f != nil {
		if err := debug.SetCrashOutput(f, debug.CrashOptions{}); err != nil {
			logger.Println("SetCrashOutput failed:", err)
		}
	}

	cfgPath := appConfigPath()
	cfg, loadErr, created := loadAppConfig(cfgPath)
	appCfg, appCfgLoadError = cfg, loadErr
	port, noPcapFile, noBrowser, autoPort = cfg.Port, !cfg.SavePcapng, !cfg.AutoOpenBrowser, cfg.AutoPort
	savePacketLogRun = cfg.SavePacketLog
	switch {
	case created:
		logger.Printf("config: wrote defaults to %s", cfgPath)
	case loadErr != "":
		logger.Printf("config: %s (%s)", loadErr, cfgPath)
	default:
		logger.Printf("config: %s", cfgPath)
	}

	if db, err := openItemStore(DataPath("items_log", "items.db")); err != nil {
		itemLogger.Printf("open item store failed: %v", err)
	} else {
		itemDB = db
	}
	logger.Printf("* mogugi v%s (fork from dilmatulgi)", Version)
}
