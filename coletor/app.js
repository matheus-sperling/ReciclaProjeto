document.addEventListener('DOMContentLoaded', () => {
  'use strict';
  const startup = document.getElementById('startup');
  if (!window.Vue || !window.Dexie || !window.ReciclaCore || !window.RECICLA_CONFIG) {
    startup.setAttribute('role', 'alert');
    startup.textContent = 'Não foi possível carregar o coletor. Na primeira abertura, conecte-se à internet para baixar as dependências e preparar o uso offline.';
    return;
  }
  const { createApp, ref, reactive, computed, onMounted, onUnmounted, nextTick } = Vue;
  createApp({
    setup() {
      const config = window.RECICLA_CONFIG;
      const db = new Dexie('recicla');
      db.version(1).stores({ entregas: 'id, moradorId, pontoId, materialId, criadoEm, status' });
      const form = reactive({ moradorId: '', pontoId: '', materialId: '', kg: '' });
      const aba = ref('nova'), manual = ref(false), revisao = ref(null);
      const erro = ref(''), sucesso = ref(''), erroCamera = ref('');
      const bancoPronto = ref(false), salvando = ref(false), exportando = ref(false);
      const cameraAtiva = ref(false), cameraOcupada = ref(false);
      const online = ref(navigator.onLine), offlinePronto = ref(false), avisoOffline = ref('');
      const escuro = ref(document.documentElement.dataset.theme !== 'light');
      const registros = ref([]), limite = ref(20);
      const registrosVisiveis = computed(() => registros.value.slice(0, limite.value));
      const totalKg = computed(() => registros.value.reduce((total, r) => total + r.kg, 0));
      const numero = value => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(value);
      const dataHora = value => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Campo_Grande' }).format(new Date(value));
      let scanner = null, inicioCamera = null, leituraRecebida = false, subscription = null;
      let registration = null;
      const atualizarRede = () => { online.value = navigator.onLine; };
      const alternarTema = () => {
        escuro.value = !escuro.value;
        const tema = escuro.value ? 'dark' : 'light';
        document.documentElement.dataset.theme = tema;
        try { localStorage.setItem('recicla-theme', tema); } catch {}
      };
      const soltarVideo = () => {
        document.querySelectorAll('#reader video').forEach(video => video.srcObject?.getTracks().forEach(track => track.stop()));
      };
      const pararCamera = async () => {
        if (!scanner) return;
        cameraOcupada.value = true;
        try {
          if (inicioCamera) await inicioCamera.catch(() => {});
          if (scanner.isScanning) await scanner.stop();
          scanner.clear();
        } catch {
          soltarVideo();
          erroCamera.value = 'A câmera foi interrompida. Tente novamente ou informe o código manualmente.';
        } finally {
          cameraAtiva.value = false;
          cameraOcupada.value = false;
        }
      };
      const iniciarCamera = async () => {
        erroCamera.value = ''; erro.value = ''; sucesso.value = '';
        if (!window.isSecureContext) { erroCamera.value = 'A câmera precisa de HTTPS. Use o endereço publicado na Vercel.'; return; }
        if (!window.Html5Qrcode) { erroCamera.value = 'O leitor de QR não carregou. Informe o código manualmente ou recarregue com conexão.'; return; }
        if (cameraOcupada.value || cameraAtiva.value) return;
        manual.value = false;
        cameraOcupada.value = true;
        leituraRecebida = false;
        await nextTick();
        try {
          scanner ||= new Html5Qrcode('reader', { formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE], useBarCodeDetectorIfSupported: false });
          inicioCamera = scanner.start({ facingMode: 'environment' }, {
            fps: 10, qrbox: (width, height) => { const size = Math.floor(Math.min(width, height) * 0.7); return { width: size, height: size }; }
          }, decoded => {
            if (leituraRecebida) return;
            try {
              const id = ReciclaCore.lerQr(decoded);
              leituraRecebida = true;
              form.moradorId = id;
              erroCamera.value = '';
              sucesso.value = 'QR lido. Confira o código e preencha os detalhes da entrega.';
              // Aguarda a inicialização antes de encerrar a câmera.
              Promise.resolve(inicioCamera).then(pararCamera).catch(() => {});
            } catch (error) { erroCamera.value = error.message; }
          }, () => {});
          await inicioCamera;
          cameraAtiva.value = true;
        } catch {
          soltarVideo();
          try { scanner?.clear(); } catch {}
          erroCamera.value = 'Não foi possível abrir a câmera. Confira a permissão do navegador ou informe o código manualmente.';
          cameraAtiva.value = false;
        } finally { cameraOcupada.value = false; }
      };
      const alternarManual = async () => {
        await pararCamera();
        manual.value = !manual.value;
        if (manual.value) { await nextTick(); document.getElementById('resident-id')?.focus(); }
      };
      const trocarAba = async value => {
        if (salvando.value || cameraOcupada.value) return;
        await pararCamera();
        aba.value = value; erro.value = ''; sucesso.value = ''; limite.value = 20;
      };
      const conferir = async () => {
        erro.value = ''; sucesso.value = '';
        if (!bancoPronto.value) { erro.value = 'O armazenamento local ainda não está disponível.'; return; }
        if (cameraAtiva.value || cameraOcupada.value) return;
        try {
          revisao.value = { ...ReciclaCore.validar(form, config), id: crypto.randomUUID() };
          await nextTick(); document.getElementById('review-title')?.focus();
        } catch (error) { erro.value = error.message; }
      };
      const salvar = async () => {
        if (salvando.value || !revisao.value || !bancoPronto.value) return;
        salvando.value = true; erro.value = '';
        try {
          const record = { ...revisao.value, criadoEm: new Date().toISOString(), status: 'local' };
          await db.entregas.add(record);
          revisao.value = null;
          form.moradorId = ''; form.materialId = ''; form.kg = '';
          manual.value = false;
          sucesso.value = `Entrega de ${numero(record.kg)} kg salva neste dispositivo.`;
          // O pedido não é condição para salvar. O navegador pode recusá-lo.
          navigator.storage?.persist?.().catch(() => {});
          await nextTick(); document.getElementById('point')?.focus();
        } catch (error) {
          erro.value = error?.name === 'QuotaExceededError'
            ? 'Armazenamento cheio. A entrega não foi salva. Exporte o histórico e libere espaço antes de tentar novamente.'
            : 'Não foi possível salvar a entrega. Os dados foram mantidos para você tentar novamente.';
        } finally { salvando.value = false; }
      };
      const exportar = async () => {
        if (exportando.value) return;
        exportando.value = true; erro.value = '';
        try {
          const entregas = await db.entregas.orderBy('criadoEm').toArray();
          const payload = { formato: 'recicla-entregas', versao: 1, exportadoEm: new Date().toISOString(), entregas };
          const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = `recicla-entregas-${new Date().toISOString().slice(0, 10)}.json`;
          document.body.append(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          sucesso.value = 'Exportação preparada. Os registros continuam neste dispositivo.';
        } catch { erro.value = 'Não foi possível exportar o histórico. Tente novamente.'; }
        finally { exportando.value = false; }
      };
      const checarOffline = async () => {
        const worker = registration?.active;
        if (!worker) return;
        try {
          const ready = await new Promise(resolve => {
            const channel = new MessageChannel();
            const finish = value => { clearTimeout(timer); channel.port1.close(); resolve(value); };
            const timer = setTimeout(() => finish(false), 4000);
            channel.port1.onmessage = event => finish(event.data?.ready === true);
            worker.postMessage({ type: 'CHECK_OFFLINE' }, [channel.port2]);
          });
          offlinePronto.value = ready;
          avisoOffline.value = ready ? '' : 'O cache offline não está completo. Reabra com internet antes de sair para a coleta.';
        } catch { avisoOffline.value = 'Não foi possível verificar o preparo offline. Reabra com internet.'; }
      };
      const prepararOffline = async () => {
        if (!('serviceWorker' in navigator) || !window.isSecureContext) {
          avisoOffline.value = 'Para preparar o uso offline, abra o coletor em HTTPS ou localhost.'; return;
        }
        try {
          registration = await navigator.serviceWorker.register('/coletor-sw.js', { scope: '/coletor' });
          if (registration.active) await checarOffline();
          const acompanhar = worker => {
            if (!worker) return;
            worker.addEventListener('statechange', () => {
              if (worker.state === 'activated') checarOffline();
              if (worker.state === 'redundant' && !registration.active) avisoOffline.value = 'O preparo offline falhou. Confira a conexão e recarregue o coletor.';
              if (worker.state === 'installed' && registration.waiting) avisoOffline.value = 'Há uma atualização. Termine a entrega, feche todas as telas do coletor e abra novamente.';
            });
          };
          acompanhar(registration.installing);
          registration.addEventListener('updatefound', () => acompanhar(registration.installing));
          if (registration.waiting) avisoOffline.value = 'Há uma atualização. Termine a entrega, feche todas as telas do coletor e abra novamente.';
        } catch { avisoOffline.value = 'Não foi possível preparar o modo offline. Use a conexão e tente recarregar.'; }
      };
      const aoOcultar = () => { if (document.hidden && (cameraAtiva.value || cameraOcupada.value)) pararCamera(); };
      const aoSair = () => { soltarVideo(); };
      onMounted(async () => {
        startup.remove();
        window.addEventListener('online', atualizarRede); window.addEventListener('offline', atualizarRede);
        document.addEventListener('visibilitychange', aoOcultar); window.addEventListener('pagehide', aoSair);
        navigator.serviceWorker?.addEventListener('controllerchange', checarOffline);
        prepararOffline();
        try {
          await db.open(); bancoPronto.value = true;
          subscription = Dexie.liveQuery(() => db.entregas.orderBy('criadoEm').reverse().toArray()).subscribe({
            next: value => { registros.value = value; },
            error: () => { erro.value = 'Não foi possível carregar o histórico local. Recarregue o coletor.'; }
          });
        } catch {
          erro.value = 'O armazenamento local está indisponível. Nenhuma entrega será salva. Confira as permissões do navegador e recarregue.';
        }
      });
      onUnmounted(() => {
        soltarVideo(); subscription?.unsubscribe(); db.close();
        window.removeEventListener('online', atualizarRede); window.removeEventListener('offline', atualizarRede);
        document.removeEventListener('visibilitychange', aoOcultar); window.removeEventListener('pagehide', aoSair);
        navigator.serviceWorker?.removeEventListener('controllerchange', checarOffline);
      });
      return { config, form, aba, manual, revisao, erro, sucesso, erroCamera, bancoPronto, salvando, exportando,
        cameraAtiva, cameraOcupada, online, offlinePronto, avisoOffline, escuro, registros, limite, registrosVisiveis,
        totalKg, numero, dataHora, alternarTema, iniciarCamera, pararCamera, alternarManual, trocarAba, conferir, salvar, exportar };
    }
  }).mount('#app');
});
