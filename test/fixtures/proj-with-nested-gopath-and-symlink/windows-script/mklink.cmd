set linkFrom=%1
set linkTo=%2


Del /f /q %linkFrom%
mklink /D %linkFrom% %linkTo%
