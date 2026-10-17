# City Golf

在粗糙的 3D 方塊城市裡打高爾夫：一桿一桿把球打到終點，球撞到的建築會被打穿、打爛。

- 產品規格：[`doc/spec.md`](doc/spec.md)
- 實作文件：[`doc/implementation/`](doc/implementation/README.md)
- Coding agent 規則：[`AGENTS.md`](AGENTS.md)

## 開發

```sh
npm install
npm run dev      # 開發伺服器；手機連同一個 Wi-Fi，開終端機顯示的 Network 網址
npm test         # 單元測試
npm run check    # 交付前檢查：格式＋lint＋型別檢查＋測試
npm run format   # 自動修正格式與可安全修正的 lint 問題
npm run build    # 型別檢查＋建置到 dist/
```

網址參數：

- `?seed=1234`：指定地圖代號
- `?debug`：開啟調參面板

## 授權

[MIT](LICENSE)
