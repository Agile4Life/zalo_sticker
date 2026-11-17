/* Personal sticker shelf for the exact Zalo PC build listed in patch.py. */
(() => {
  'use strict';
  if (window.GiaoLangSticker) return;
  const VERSION = '0.2.1';
  const MAX_FILE = 10 * 1024 * 1024;
  const MIME = /^image\/(png|webp|gif|jpeg)$/;
  const listeners = new Set();
  const libraries = new Map();
  const url = value => {
    if (typeof value !== 'string') return '';
    if (value.startsWith('//')) value = 'https:' + value;
    try { const u = new URL(value); return u.protocol === 'https:' ? u.href : ''; }
    catch { return ''; }
  };
  const json = value => {
    if (value && typeof value === 'object') return value;
    try { return JSON.parse(value || '{}'); } catch { return {}; }
  };
  const notify = () => listeners.forEach(fn => fn());
  const db = new Promise((resolve, reject) => {
    const r = indexedDB.open('giaolang-personal-stickers', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('libraries');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(new Error('Không mở được bộ sticker trên máy này.'));
  });
  async function load(owner) {
    if (libraries.has(owner)) return libraries.get(owner);
    const connection = await db;
    const value = await new Promise((resolve, reject) => {
      const tx = connection.transaction('libraries', 'readonly');
      const r = tx.objectStore('libraries').get(owner);
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    });
    libraries.set(owner, value);
    return value;
  }
  async function save(owner, items) {
    const connection = await db;
    await new Promise((resolve, reject) => {
      const tx = connection.transaction('libraries', 'readwrite');
      tx.objectStore('libraries').put(items, owner);
      tx.oncomplete = resolve;
      tx.onabort = tx.onerror = () => reject(tx.error || new Error('Không lưu được sticker.'));
    });
    libraries.set(owner, items);
    notify();
  }
  function collect(controller, constants) {
    const messages = controller._mapReduxState().state.messages || [];
    const found = new Map();
    for (const message of messages) {
      if (![constants.MSG_PHOTO, constants.MSG_PHOTO_GROUP, constants.MSG_GIF].includes(message.msgType)) continue;
      const entries = Array.isArray(message.message) ? message.message : [message];
      for (const entry of entries) {
        const media = entry.message && typeof entry.message === 'object' ? entry.message : entry;
        const params = json(media.params);
        const webp = json(params.webp);
        const original = url(media.oriUrl || media.hdUrl || media.normalUrl || media.href);
        const animation = url(webp.url);
        const main = animation || original;
        if (!main) continue;
        const width = Number(webp.width || params.width || media.width) || 512;
        const height = Number(webp.height || params.height || media.height) || 512;
        if (!(width > 0 && height > 0 && width <= 20000 && height <= 20000)) continue;
        if (found.has(main)) continue;
        found.set(main, {
          id: 'gl-' + crypto.randomUUID(), name: 'Sticker ' + (found.size + 1),
          url: main, pngUrl: original || main,
          previewUrl: url(media.thumbUrl || media.normalUrl) || original || main,
          width, height, pngWidth: Number(media.width || params.width) || width,
          pngHeight: Number(media.height || params.height) || height,
          animated: !!animation || message.msgType === constants.MSG_GIF,
          sourceMessageId: String(message.msgId || ''),
        });
      }
    }
    return Array.from(found.values()).reverse();
  }
  async function snapshot(item) {
    // Snapshot bytes for local backups when the CDN allows reading this image.
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 8000);
    try {
      const response = await fetch(item.url, {credentials: 'omit', referrerPolicy: 'no-referrer', signal: abort.signal});
      if (!response.ok) return item;
      if (Number(response.headers.get('content-length')) > MAX_FILE) return item;
      const blob = await response.blob();
      if (blob.size > MAX_FILE || !MIME.test(blob.type)) return item;
      return await prepareBlob({...item, blob});
    } catch { return item; }
    finally { clearTimeout(timer); }
  }
  async function prepareBlob(item) {
    if (item.animated || item.webpBlob || !item.blob) return item;
    const bitmap = await createImageBitmap(item.blob);
    try {
      const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const webpBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.95));
      if (!webpBlob || webpBlob.type !== 'image/webp') throw new Error('Chưa chuyển được ảnh thành sticker WebP.');
      return {...item, webpBlob, width: canvas.width, height: canvas.height};
    } finally { bitmap.close(); }
  }
  function request(selector, action, extra = {}) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(action === 'send'
        ? 'Chưa nhận được kết quả. Hãy kiểm tra đoạn chat trước khi thử gửi lại.'
        : 'Không kết nối được với đoạn chat. Hãy đóng bảng sticker rồi mở lại.')), action === 'send' ? 90000 : 5000);
      selector.props.sendSticker({__giaoLang: true, action, ...extra,
        reply: (error, data) => { clearTimeout(timer); error ? reject(new Error(error)) : resolve(data); }
      });
    });
  }
  async function bridge(controller, request, native) {
    const reply = typeof request.reply === 'function' ? request.reply : () => {};
    try {
      const owner = String(controller.user && controller.user.userId || '');
      if (!owner) throw new Error('Chưa xác định được tài khoản Zalo hiện tại.');
      const conversation = controller._getConversationInfo();
      if (!conversation || !conversation.userId) throw new Error('Hãy mở một đoạn chat trước.');
      if (request.action === 'context') return reply(null, {owner, conversationId: conversation.userId});
      if (request.action === 'collect') return reply(null, {owner, items: collect(controller, native.constants)});
      if (request.action !== 'send') throw new Error('Thao tác sticker không hợp lệ.');
      if (request.owner !== owner || request.conversationId !== conversation.userId)
        throw new Error('Đoạn chat đã thay đổi. Hãy chọn lại sticker.');
      if (native.locked()) throw new Error('Hiện không thể gửi tin nhắn trong đoạn chat này.');
      let item = request.item;
      if (!item || (!item.blob && (!url(item.url) || !url(item.pngUrl) || !url(item.previewUrl))))
        throw new Error('Sticker chưa có ảnh nguồn hợp lệ trên Zalo.');
      const upload = async (blob, name) => {
        const data = await native.upload(new File([blob], name, {type: blob.type}), conversation.userId);
        const result = data && data.urlRes && data.urlRes.fileAsync;
        const remote = url(result && (result.fileUrl || result.oriUrl || result.hdUrl));
        if (!remote) throw new Error('Zalo chưa trả về địa chỉ ảnh sticker.');
        return remote;
      };
      if (item.animated && item.blob && !url(item.url)) {
        if (item.blob.type !== 'image/webp') throw new Error('Gói này có ảnh GIF. Hãy gửi GIF qua Zalo để dùng như sticker động.');
        item = {...item, url:await upload(item.blob, item.id + '.webp')};
      }
      // Imported Apple PNG cutouts become real WebP assets with alpha preserved.
      if (!item.animated && !item.uploadedWebpUrl) {
        item = item.blob ? await prepareBlob(item) : await snapshot(item);
        if (!item.webpBlob) throw new Error('Không đọc được ảnh nguồn. Hãy tải ảnh trên Zalo về rồi dùng nút Nhập ảnh.');
        item = {...item, uploadedWebpUrl: await upload(item.webpBlob, item.id + '.webp')};
      }
      if (item.blob && !url(item.pngUrl)) {
        const originalUrl = await upload(item.blob, item.id + (item.blob.type === 'image/webp' ? '.webp' : '.png'));
        item = {...item, pngUrl: originalUrl, previewUrl: originalUrl};
      }
      const existing = await load(owner);
      await save(owner, existing.map(x => x.id === item.id ? item : x));
      const current = controller._getConversationInfo();
      if (!current || current.userId !== conversation.userId || String(controller.user.userId) !== owner)
        throw new Error('Đoạn chat đã thay đổi trong lúc tải ảnh. Sticker chưa được gửi.');
      if (native.locked()) throw new Error('Hiện không thể gửi tin nhắn trong đoạn chat này.');
      item = {...item, url: item.uploadedWebpUrl || item.url};
      const sticker = native.photo.Helper.getPhotoStickerDataTemplate(item);
      const message = native.photo.Helper.getMessageObjectFromPhotoStickerData(conversation.userId, sticker);
      message.params.pStickerType = 1;
      const options = {
        isPhotoSticker: true, contentId: sticker.id,
        thumbHeight: sticker.pngHeight, thumbWidth: sticker.pngWidth,
        webp: {width: sticker.width, height: sticker.height, url: sticker.url},
        propertyExt: {sSrcStr: '@STICKER', sSrcType: 0}, pStickerType: 1,
      };
      // _sendMessage handles the current client's authentication, permissions and E2EE.
      // No separate account session or listener is created.
      controller._sendMessage(conversation, native.constants.MSG_PHOTO, message,
        false, null, null, null, null, true, true, false,
        () => {
          native.recents.default.addPhotoStickerToRecentList(sticker, native.recents.UPDATE_RECENT_TRIGGER_POINT.PC_SEND);
        },
        () => { window.alert('Zalo báo gửi sticker thất bại. Hãy kiểm tra ảnh nguồn trong Cloud của tôi.'); },
        options);
      reply(null, {queued: true});
    } catch (error) { reply(error.message || 'Không thực hiện được thao tác sticker.'); }
  }
  function install(React, Selector) {
    if (Selector.prototype.__giaoLangInstalled) return;
    Selector.prototype.__giaoLangInstalled = true;
    const h = React.createElement;
    const originalRender = Selector.prototype.render;
    const originalUpdate = Selector.prototype.shouldComponentUpdate;
    Selector.prototype.shouldComponentUpdate = function(props, state, ...rest) {
      if (this.state.glActive !== state.glActive) return true;
      return originalUpdate ? originalUpdate.call(this, props, state, ...rest) : true;
    };
    class Shelf extends React.Component {
      constructor(props) {
        super(props);
        this.state = {loading: true, items: [], candidates: null, error: '', busy: false, edit: false, query: '', addOpen: false};
        this.live = true;
        this.closeAddMenu = event => {
          if (this.state.addOpen && this.addMenuRoot && !this.addMenuRoot.contains(event.target)) this.setState({addOpen:false});
        };
        this.refresh = () => { if (this.contextInfo && this.live) load(this.contextInfo.owner).then(items => this.live && this.setState({items})); };
      }
      async componentDidMount() {
        listeners.add(this.refresh);
        document.addEventListener('pointerdown', this.closeAddMenu);
        try {
          this.contextInfo = await request(this.props.selector, 'context');
          const items = await load(this.contextInfo.owner);
          if (this.live) this.setState({items, loading: false});
        } catch (error) { if (this.live) this.setState({error: error.message, loading: false}); }
      }
      componentWillUnmount() { this.live = false; listeners.delete(this.refresh); document.removeEventListener('pointerdown', this.closeAddMenu); }
      async getCandidates() {
        this.setState({error: '', busy: true});
        try {
          const data = await request(this.props.selector, 'collect');
          if (data.owner !== this.contextInfo.owner) throw new Error('Tài khoản đã thay đổi. Hãy mở lại bảng sticker.');
          if (this.live) this.setState({candidates: data.items, busy: false});
        } catch (error) { if (this.live) this.setState({error: error.message, busy: false}); }
      }
      async add(item) {
        if (this.state.busy) return;
        this.setState({busy: true, error: ''});
        try {
          const items = await load(this.contextInfo.owner);
          if (!items.some(x => x.url === item.url)) await save(this.contextInfo.owner, [...items, await snapshot(item)]);
          if (this.live) this.setState({busy: false});
        } catch (error) { if (this.live) this.setState({busy: false, error: error.message}); }
      }
      async clickItem(item) {
        if (this.state.busy) return;
        if (this.state.edit) {
          await save(this.contextInfo.owner, this.state.items.filter(x => x.id !== item.id));
          return;
        }
        this.setState({busy: true, error: ''});
        try { await request(this.props.selector, 'send', {...this.contextInfo, item}); }
        catch (error) { if (this.live) this.setState({error: error.message}); }
        finally { if (this.live) this.setState({busy: false}); }
      }
      async importFiles(files) {
        this.setState({busy: true, error: ''});
        try {
          const added = [];
          for (const blob of Array.from(files || [])) {
            if (!MIME.test(blob.type) || blob.size > MAX_FILE) throw new Error('Chọn ảnh PNG, WebP, GIF hoặc JPEG dưới 10 MB.');
            const bitmap = await createImageBitmap(blob);
            const width = bitmap.width, height = bitmap.height;
            bitmap.close();
            const previewUrl = await new Promise((resolve, reject) => {
              const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob);
            });
            // Local GIF/WebP animations require a native animated WebP source; do not flatten silently.
            if (blob.type === 'image/gif' || blob.type === 'image/webp')
              throw new Error('Với sticker động, hãy gửi qua Zalo rồi dùng Lấy từ đoạn chat. Nhập ảnh hiện hỗ trợ PNG/JPEG.');
            added.push(await prepareBlob({id: 'gl-' + crypto.randomUUID(), name: blob.name || 'Sticker',
              blob, previewUrl, url: '', pngUrl: '', width, height, pngWidth: width, pngHeight: height, animated: false}));
          }
          await save(this.contextInfo.owner, [...await load(this.contextInfo.owner), ...added]);
        } catch (error) { if (this.live) this.setState({error: error.message}); }
        finally { if (this.live) this.setState({busy: false}); }
      }
      async exportZip() {
        if (this.state.busy) return;
        this.setState({busy:true,error:'',notice:''});
        try {
          const items = await load(this.contextInfo.owner);
          const bytes = await window.GiaoLangStickerPack.exportPack(items, async item => {
            if (item.blob) return item.blob;
            const fetched = await snapshot(item);
            if (!fetched.blob) throw new Error('Không tải được ảnh “' + item.name + '”. Hãy tải ảnh gốc về và nhập lại trước khi xuất ZIP.');
            return fetched.blob;
          });
          const link = document.createElement('a');
          const address = URL.createObjectURL(new Blob([bytes], {type:'application/zip'}));
          link.href = address; link.download = 'sticker-cua-toi.zip';
          document.body.appendChild(link); link.click(); link.remove();
          setTimeout(() => URL.revokeObjectURL(address), 60000);
          if (this.live) this.setState({notice:'Đã xuất ' + items.length + ' sticker. Gửi tệp ZIP cho bạn bè để nhập lại.'});
        } catch (error) { if (this.live) this.setState({error:error.message}); }
        finally { if (this.live) this.setState({busy:false}); }
      }
      async importZip(file) {
        if (!file || this.state.busy) return;
        this.setState({busy:true,error:'',notice:''});
        try {
          if (file.size > 101 * 1024 * 1024) throw new Error('Gói ZIP vượt quá 100 MB.');
          const entries = await window.GiaoLangStickerPack.importPack(await file.arrayBuffer());
          const existing = await load(this.contextInfo.owner), added = [];
          const hashes = new Set(await Promise.all(existing.map(async item => item.assetHash || (item.blob ? window.GiaoLangStickerPack.hash(await item.blob.arrayBuffer()) : ''))));
          for (const entry of entries) {
            if (hashes.has(entry.assetHash)) continue;
            const bitmap = await createImageBitmap(entry.blob);
            const width = bitmap.width, height = bitmap.height; bitmap.close();
            if (width * height > 16777216) throw new Error('Kích thước ảnh trong gói quá lớn.');
            const previewUrl = await new Promise((resolve,reject) => {
              const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(entry.blob);
            });
            added.push(await prepareBlob({...entry,id:'gl-' + crypto.randomUUID(),url:'',pngUrl:'',previewUrl,width,height,pngWidth:width,pngHeight:height}));
            hashes.add(entry.assetHash);
          }
          await save(this.contextInfo.owner, [...existing,...added]);
          if (this.live) this.setState({candidates:null,notice:'Đã thêm ' + added.length + ' sticker' + (entries.length > added.length ? '; bỏ qua ảnh trùng.' : '.')});
        } catch (error) { if (this.live) this.setState({error:error.message}); }
        finally { if (this.live) this.setState({busy:false}); }
      }
      render() {
        const {items, candidates, error, notice, loading, busy, edit, query, addOpen} = this.state;
        const picking = candidates !== null;
        const list = (picking ? candidates : items).filter(x => x.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
        const button = (text, onClick, extra = {}) => h('button', {type: 'button', className: 'gl-button', onClick, disabled: busy || loading, ...extra}, text);
        const icon = name => h('svg',{width:15,height:15,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.7,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true},
          ...(name === 'plus' ? [h('path',{key:1,d:'M12 5v14M5 12h14'})]
          : name === 'down' ? [h('path',{key:1,d:'m7 10 5 5 5-5'})]
          : name === 'search' ? [h('circle',{key:1,cx:10.5,cy:10.5,r:6.5}),h('path',{key:2,d:'m16 16 4 4'})]
          : name === 'export' ? [h('path',{key:1,d:'M12 15V3m-4 4 4-4 4 4M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5'})]
          : name === 'chat' ? [h('path',{key:1,d:'M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 3V6a2 2 0 0 1 2-2Z'}),h('path',{key:2,d:'M7 9h10M7 13h6'})]
          : name === 'photo' ? [h('rect',{key:1,x:3,y:3,width:18,height:18,rx:3}),h('circle',{key:2,cx:8,cy:8,r:1.5}),h('path',{key:3,d:'m3 17 5-5 4 4 4-5 5 6'})]
          : [h('path',{key:1,d:'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Zm0 0v6h6M10 6v2m0 3v2m0 3v2'})]));
        const menuItem = (symbol,text,action) => button([icon(symbol),h('span',{key:'label'},text)],() => {this.setState({addOpen:false});action();},
          {className:'gl-button gl-menu-item',role:'menuitem'});
        return h('div', {className: 'gl-shelf', 'data-giaolang-shelf': VERSION},
          h('div', {className: 'gl-heading'},
            h('div',{className:'gl-title'},h('strong', null, picking ? 'Chọn ảnh để lưu' : 'Sticker của tôi'),
              h('span',{className:'gl-count',title:(picking ? candidates.length : items.length) + ' sticker'},picking ? candidates.length : items.length)),
            picking ? button('Xong', () => this.setState({candidates: null,query:''}),{className:'gl-button gl-text-button'})
              : button(edit ? 'Xong' : 'Quản lý', () => this.setState({edit: !edit}),{className:'gl-button gl-text-button'})),
          h('div', {className:'gl-toolbar'},
            h('div',{className:'gl-add-menu',ref:e => this.addMenuRoot=e,onKeyDown:e => {
              if(e.key === 'Escape' && this.state.addOpen){e.stopPropagation();this.setState({addOpen:false});this.addButton && this.addButton.focus();}
            }},button([icon('plus'),h('span',{key:'label'},'Thêm'),icon('down')],() => this.setState({addOpen:!addOpen}),
                {className:'gl-button gl-primary-button','aria-haspopup':'menu','aria-expanded':!!addOpen,ref:e => this.addButton=e}),
              addOpen && h('div',{className:'gl-dropdown',role:'menu','aria-label':'Thêm sticker'},
                menuItem('chat','Từ đoạn chat',() => this.getCandidates()),
                menuItem('photo','Nhập ảnh',() => this.fileInput.click()),
                menuItem('zip','Nhập ZIP',() => this.zipInput.click()))),
            button([icon('export'),h('span',{key:'label'},'Xuất ZIP')],() => this.exportZip(),
              {className:'gl-button gl-export-button',disabled:busy || loading || !items.length}),
            busy && h('span',{className:'gl-busy',role:'status'},'Đang xử lý…')),
          h('input', {type:'file',accept:'image/png,image/jpeg',multiple:true,style:{display:'none'},ref:e => this.fileInput=e,
            onChange:e => {this.importFiles(e.target.files);e.target.value='';}}),
          h('input',{type:'file',accept:'.zip,application/zip',style:{display:'none'},ref:e => this.zipInput=e,
            onChange:e => {this.importZip(e.target.files[0]);e.target.value='';}}),
          h('div',{className:'gl-search-field'},icon('search'),
            h('input', {className: 'gl-search', placeholder:picking ? 'Tìm ảnh trong đoạn chat' : 'Tìm sticker', value: query,
              onChange:e => this.setState({query:e.target.value}),'aria-label':'Tìm sticker của tôi'})),
          error && h('div', {className: 'gl-error', role: 'alert'}, error),
          notice && h('div',{className:'gl-note',role:'status'},notice),
          h('div', {className: 'gl-grid', 'aria-busy': busy}, list.map(item => {
            const saved = items.some(x => x.url === item.url);
            return h('button', {type: 'button', className: 'gl-sticker' + (edit ? ' gl-removing' : ''), key: item.id,
              disabled: busy || (picking && saved), title: picking ? (saved ? 'Đã thêm' : 'Thêm vào bộ sticker') : edit ? 'Bỏ khỏi bộ sticker' : 'Gửi sticker',
              onClick: () => picking ? this.add(item) : this.clickItem(item)},
              h('img', {src: item.previewUrl || item.pngUrl, alt: item.name, draggable: false, referrerPolicy: 'no-referrer'}),
              picking && h('span', {className: 'gl-badge'}, saved ? '✓' : '+'), edit && h('span', {className: 'gl-badge'}, '×'));
          })),
          !list.length && h('div', {className: 'gl-empty'}, loading ? 'Đang mở bộ sticker…' : picking
            ? 'Chưa thấy ảnh. Mở Cloud của tôi và cuộn tới các sticker đã gửi, rồi bấm Lấy từ đoạn chat.'
            : 'Gửi sticker từ iPhone vào Cloud của tôi, rồi chọn Thêm → Từ đoạn chat. Bạn cũng có thể nhập ảnh hoặc bộ ZIP.'),
          picking && h('p', {className: 'gl-note'}, 'Bấm + để lưu. Thao tác này không gửi tin nhắn.'),
          edit && h('p', {className: 'gl-note'}, 'Bấm × để bỏ sticker khỏi bộ trên máy này.'));
      }
    }
    function transform(node, selector) {
      if (!React.isValidElement(node)) return node;
      const props = node.props || {};
      const classes = String(props.className || '').split(/\s+/);
      if (classes.includes('sticker-selector__content') && selector.state.glActive)
        return React.cloneElement(node, {'data-giaolang-active': true}, h(Shelf, {selector}));
      const mapChildren = children => Array.isArray(children)
        ? children.map(mapChildren) : transform(children, selector);
      let children = mapChildren(props.children);
      if (classes.includes('sticker-selector__menu__scrollbar')) {
        const active = !!selector.state.glActive;
        const own = h('button', {key: 'gl-personal-tab', type: 'button', className: 'gl-tab' + (active ? ' active' : ''),
          title: 'Sticker của tôi', 'aria-label': 'Sticker của tôi', 'aria-pressed': active,
          onMouseDown: e => e.preventDefault(), onClick: e => {e.stopPropagation(); selector.setState({glActive: !active});}}, '★');
        children = [own, children];
      }
      const nextProps = {};
      if (props.onClick && (classes.includes('sticker-selector__menu__item') || classes.includes('sticker-recent') || classes.includes('sticker-recent-active'))) {
        nextProps.onClick = (...args) => { selector.setState({glActive: false}); return props.onClick(...args); };
      }
      return React.cloneElement(node, nextProps, children);
    }
    Selector.prototype.render = function(...args) { return transform(originalRender.apply(this, args), this); };
    if (!document.getElementById('giaolang-sticker-style')) {
      const style = document.createElement('style');
      style.id = 'giaolang-sticker-style';
      style.textContent = `
        .gl-tab{flex:0 0 44px;width:44px;height:36px;border:0;background:transparent;color:var(--text-secondary,#64748b);font-size:26px;cursor:pointer;border-radius:6px}
        .gl-tab.active{color:var(--text-primary-color,#0068ff);background:var(--layer-background-hover,#e8f0ff)}
        .gl-shelf{height:100%;min-height:0;display:flex;flex-direction:column;padding:8px 12px 10px;box-sizing:border-box;color:var(--text-primary,#172b4d);background:var(--layer-background,#fff)}
        .gl-heading{display:flex;flex:0 0 auto;align-items:center;justify-content:space-between;gap:8px;min-height:26px;margin-bottom:7px}.gl-title{display:flex;align-items:center;gap:7px;min-width:0}.gl-title strong{font-size:14px;font-weight:600;line-height:20px;white-space:nowrap}
        .gl-count{display:inline-flex;align-items:center;justify-content:center;min-width:21px;height:19px;padding:0 5px;box-sizing:border-box;border-radius:6px;background:var(--layer-background-hover,#f0f2f5);font-size:11px;font-weight:500;color:var(--text-secondary,#64748b)}
        .gl-toolbar{display:flex;flex:0 0 auto;align-items:center;gap:7px;margin-bottom:9px}.gl-shelf .gl-button{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:5px;flex-shrink:0;min-width:0;min-height:0;height:28px;line-height:1;font-family:inherit;font-size:12px;font-weight:500;white-space:nowrap;border:1px solid var(--border-subtle,#e3e7ed);background:var(--layer-background,#fff);color:var(--text-primary,#344054);padding:0 9px;border-radius:6px;cursor:pointer;box-shadow:none}
        .gl-shelf .gl-button svg{display:block;flex-shrink:0}.gl-shelf .gl-text-button{border:0;background:transparent;color:var(--text-primary-color,#0068ff);height:24px;padding:0 2px;font-weight:400}.gl-shelf .gl-primary-button{border-color:#0068ff;background:#0068ff;color:#fff;padding:0 8px 0 7px}.gl-shelf .gl-primary-button:hover{background:#005ce5}.gl-shelf .gl-export-button:hover{background:var(--layer-background-hover,#f5f7fa)}
        .gl-button:focus-visible,.gl-sticker:focus-visible{outline:2px solid #8ebaff;outline-offset:2px}.gl-button:disabled,.gl-sticker:disabled{opacity:.45;cursor:default}.gl-note,.gl-busy{font-size:11px;color:var(--text-secondary,#64748b)}.gl-busy{margin-left:auto}
        .gl-add-menu{position:relative;flex-shrink:0}.gl-dropdown{position:absolute;z-index:30;top:calc(100% + 5px);left:0;min-width:164px;box-sizing:border-box;padding:4px;border:1px solid var(--border-subtle,#e5e9ef);border-radius:9px;background:var(--layer-background,#fff);box-shadow:0 6px 20px #10182820}.gl-shelf .gl-menu-item{display:flex;justify-content:flex-start;width:100%;height:33px;gap:9px;border:0;border-radius:5px;padding:0 9px;font-weight:400}.gl-shelf .gl-menu-item:hover{background:var(--layer-background-hover,#f0f5ff);color:var(--text-primary-color,#0068ff)}
        .gl-search-field{box-sizing:border-box;display:flex;flex:0 0 auto;align-items:center;gap:7px;height:31px;padding:0 10px;margin-bottom:8px;border:1px solid transparent;border-radius:7px;background:var(--layer-background-hover,#f2f4f7);color:var(--text-secondary,#667085)}.gl-search-field:focus-within{border-color:#80adff}.gl-search-field svg{flex-shrink:0}.gl-shelf .gl-search{box-sizing:border-box;flex:1;min-width:0;width:100%;height:100%;padding:0;margin:0;border:0;border-radius:0;font:inherit;font-size:12px;background:transparent;color:var(--text-primary,#172b4d);outline:none;box-shadow:none}.gl-search::placeholder{color:var(--text-secondary,#7b8797)}
        .gl-grid{min-height:0;overflow:auto;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:5px;align-content:start}
        .gl-sticker{position:relative;aspect-ratio:1;min-width:0;display:flex;align-items:center;justify-content:center;border:0;background:transparent;border-radius:7px;cursor:pointer;padding:3px}
        .gl-sticker:hover{background:var(--layer-background-hover,#eef3fa)}.gl-sticker img{width:100%;height:100%;object-fit:contain}
        .gl-badge{position:absolute;right:0;top:0;background:#0068ff;color:white;border-radius:10px;min-width:18px;height:18px;line-height:18px;font-size:14px}.gl-removing .gl-badge{background:#d93025}
        .gl-empty{font-size:13px;line-height:1.6;padding:12px 4px;color:var(--text-secondary,#64748b)}.gl-error{font-size:12px;line-height:1.5;color:#cf3030;padding:5px 0}.gl-note{margin:6px 0 0;line-height:1.4}
      `;
      document.head.appendChild(style);
    }
  }
  window.GiaoLangSticker = {version: VERSION, install, bridge};
})();
