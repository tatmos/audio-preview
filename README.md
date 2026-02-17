# オーディオプレビュー

オーディオファイルリストの再生・BPM/Key/Mood 表示など。

## Mood 列について

リストの **Mood** 列は Essentia.js の MusiCNN（msd-musicnn-1）でタグ推定した結果を表示します。

**モデルは [MTG/essentia.js の examples](https://github.com/MTG/essentia.js/tree/master/examples/demos/autotagging-rt) に含まれる `data/msd-musicnn-1` を、jsDelivr CDN 経由で自動読み込みします。ZIP のダウンロードやローカル配置は不要です。**

開発サーバー起動後、リストにオーディオを追加すると自動で Mood 解析が走り、上位 3 タグ（例: `rock, electronic, chill`）が表示されます。Key や BPM と同様にそのまま利用できます。
