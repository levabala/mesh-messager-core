message=${1:-update}

git add ./
git commit -m "$message"
git push origin master