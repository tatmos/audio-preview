@echo off
cd /d "%~dp0"

if not exist "node_modules" (
  echo node_modules が見つかりません。npm install を実行します...
  call npm install
  if errorlevel 1 (
    echo インストールに失敗しました。
    pause
    exit /b 1
  )
)

echo 開発サーバーを起動しています...
echo ブラウザで http://localhost:5173/ を開いてください。
echo 終了するにはこのウィンドウで Ctrl+C を押すか、ウィンドウを閉じてください。
echo.
call npm run dev

pause
