@echo off
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/Arham0003/Medstocksy.git
git push -u origin main
