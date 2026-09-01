#!/bin/bash
# 自動レビューの動作確認用の使い捨てスクリプト。マージしない。

ROOT=$1

count=0
for d in $(ls $ROOT); do
  if [ -f $ROOT/$d/SKILL.md ]; then
    count=`expr $count + 1`
    name=$(grep "^name:" $ROOT/$d/SKILL.md | cut -d: -f2)
    echo "found: $name"
  fi
done

echo "total: $count skills"
exit 0
