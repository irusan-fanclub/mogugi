# MOGUGI

Mabinogi 傷害統計工具(Taiwan region)。fork 自 prilus/dilmatulgi。

Mabinogi damage meter for the Taiwan region. Go backend + Vue frontend, forked from prilus/dilmatulgi.

## 開發

- `.\build.ps1`：建置 `bin\mogugi.exe`。
- `.\run.ps1`：從終端機執行 `bin\mogugi.exe`，可用 Ctrl+C 關閉。
  直接輸入 `.\bin\mogugi.exe` 時，PowerShell 不會等待這個 GUI 程式，Ctrl+C 會被 PowerShell 自己吃掉，程式收不到。
- `.\dev-run.ps1`：以 `go run` 執行（同樣可用 Ctrl+C 關閉）。
