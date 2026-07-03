// ============================================================
// VERTEXT PAY — Dashboard Logic
// Handles: wallet balance, deposit (Paystack), withdraw,
//          transactions, bank accounts
// ============================================================

let supabaseClient;
let currentUser;
let currentBalance = 0;
let bankAccounts = [];

document.addEventListener('DOMContentLoaded', async () => {
  const cfg = window.VERTEXT_CONFIG;

  // ── Init Supabase ──────────────────────────────────────────
  supabaseClient = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  // ── Auth guard ─────────────────────────────────────────────
  currentUser = await requireAuth(supabaseClient);
  if (!currentUser) return;

  // ── Set user info ──────────────────────────────────────────
  const nameEl = document.getElementById('user-name');
  const avatarEl = document.getElementById('user-avatar');
  const emailEl = document.getElementById('user-email');

  const displayName = currentUser.user_metadata?.full_name
    || currentUser.email?.split('@')[0]
    || 'User';

  if (nameEl) nameEl.textContent = displayName;
  if (emailEl) emailEl.textContent = currentUser.email;
  if (avatarEl) avatarEl.textContent = displayName.charAt(0).toUpperCase();

  // ── Load data in parallel ──────────────────────────────────
  await Promise.all([
    loadWallet(),
    loadTransactions(),
    loadBankAccounts()
  ]);

  // ── Realtime: wallet balance updates ───────────────────────
  supabaseClient
    .channel('wallet-changes')
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'wallets',
      filter: `user_id=eq.${currentUser.id}`
    }, (payload) => {
      currentBalance = Number(payload.new.balance);
      updateBalanceDisplay(currentBalance);
    })
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'transactions',
      filter: `user_id=eq.${currentUser.id}`
    }, () => {
      loadTransactions(); // Refresh transaction list
    })
    .subscribe();

  // ── Logout ─────────────────────────────────────────────────
  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    await supabaseClient.auth.signOut();
    window.location.href = '/index.html';
  });

  // ── Deposit button ─────────────────────────────────────────
  document.getElementById('deposit-btn')?.addEventListener('click', openDepositModal);
  document.getElementById('quick-deposit-btn')?.addEventListener('click', openDepositModal);

  // ── Withdraw button ────────────────────────────────────────
  document.getElementById('withdraw-btn')?.addEventListener('click', openWithdrawModal);

  // ── Add Bank Account ───────────────────────────────────────
  document.getElementById('add-bank-btn')?.addEventListener('click', () => openModal('add-bank-modal'));

  // ── Confirm deposit amount ─────────────────────────────────
  document.getElementById('confirm-deposit-btn')?.addEventListener('click', initiateDeposit);

  // ── Confirm withdrawal ─────────────────────────────────────
  document.getElementById('confirm-withdraw-btn')?.addEventListener('click', initiateWithdrawal);

  // ── Save bank account ──────────────────────────────────────
  document.getElementById('save-bank-btn')?.addEventListener('click', saveBankAccount);

  // ── Withdraw bank account selector ────────────────────────
  document.getElementById('withdraw-bank-select')?.addEventListener('change', updateWithdrawMax);
});

// ─── WALLET ─────────────────────────────────────────────────
async function loadWallet() {
  const { data, error } = await supabaseClient
    .from('wallets')
    .select('balance, currency, updated_at')
    .eq('user_id', currentUser.id)
    .single();

  if (error) {
    console.error('Wallet error:', error);
    return;
  }

  currentBalance = Number(data.balance);
  updateBalanceDisplay(currentBalance);

  const lastUpdatedEl = document.getElementById('balance-updated');
  if (lastUpdatedEl) {
    lastUpdatedEl.textContent = `Updated ${formatDate(data.updated_at)}`;
  }
}

function updateBalanceDisplay(balance) {
  const el = document.getElementById('wallet-balance');
  if (!el) return;

  // Animate count-up
  const start = Number(el.dataset.value || 0);
  const end = balance;
  const duration = 600;
  const startTime = performance.now();

  function animate(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    const current = start + (end - start) * eased;
    el.textContent = formatCurrency(current);
    el.dataset.value = balance;
    if (progress < 1) requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
}

// ─── TRANSACTIONS ─────────────────────────────────────────────
async function loadTransactions() {
  const { data, error } = await supabaseClient
    .from('transactions')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false })
    .limit(20);

  const list = document.getElementById('transaction-list');
  const empty = document.getElementById('txn-empty');
  if (!list) return;

  if (error || !data?.length) {
    list.innerHTML = '';
    if (empty) empty.classList.remove('hidden');
    return;
  }

  if (empty) empty.classList.add('hidden');

  list.innerHTML = data.map(txn => `
    <div class="txn-item" style="animation: fadeInUp 0.3s ease both; animation-delay: ${Math.random() * 0.15}s">
      <div class="txn-icon txn-icon-${txn.type}">
        ${txn.type === 'deposit' ? '↓' : '↑'}
      </div>
      <div class="txn-details">
        <div class="txn-description">${txn.description || (txn.type === 'deposit' ? 'Deposit' : 'Withdrawal')}</div>
        <div class="txn-date">${formatDate(txn.created_at)}</div>
      </div>
      <div class="txn-right">
        <div class="txn-amount txn-amount-${txn.type}">
          ${txn.type === 'deposit' ? '+' : '-'}${formatCurrency(txn.amount)}
        </div>
        <span class="badge badge-${txn.status}">${txn.status}</span>
      </div>
    </div>
  `).join('');

  // Update stats
  const deposits = data.filter(t => t.type === 'deposit' && t.status === 'success');
  const withdrawals = data.filter(t => t.type === 'withdrawal' && t.status === 'success');

  const totalDeposited = deposits.reduce((s, t) => s + Number(t.amount), 0);
  const totalWithdrawn = withdrawals.reduce((s, t) => s + Number(t.amount), 0);

  const depEl = document.getElementById('total-deposited');
  const wdEl = document.getElementById('total-withdrawn');
  if (depEl) depEl.textContent = formatCurrency(totalDeposited);
  if (wdEl) wdEl.textContent = formatCurrency(totalWithdrawn);
  const txnCountEl = document.getElementById('txn-count');
  if (txnCountEl) txnCountEl.textContent = data.length;
}

// ─── BANK ACCOUNTS ────────────────────────────────────────────
async function loadBankAccounts() {
  const { data, error } = await supabaseClient
    .from('bank_accounts')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false });

  bankAccounts = data || [];
  renderBankAccounts();
  populateBankSelect();
}

function renderBankAccounts() {
  const list = document.getElementById('bank-account-list');
  const empty = document.getElementById('bank-empty');
  if (!list) return;

  if (!bankAccounts.length) {
    list.innerHTML = '';
    if (empty) empty.classList.remove('hidden');
    return;
  }

  if (empty) empty.classList.add('hidden');

  list.innerHTML = bankAccounts.map(acct => `
    <div class="bank-item">
      <div class="bank-icon">📱</div>
      <div class="bank-details">
        <div class="bank-name">M-Pesa</div>
        <div class="bank-account-num">${acct.account_name} • ${acct.account_number}</div>
      </div>
      <button class="btn btn-sm btn-danger" onclick="deleteBankAccount('${acct.id}')">Remove</button>
    </div>
  `).join('');
}

function populateBankSelect() {
  const select = document.getElementById('withdraw-bank-select');
  if (!select) return;

  if (!bankAccounts.length) {
    select.innerHTML = '<option value="">No M-Pesa accounts saved</option>';
    return;
  }

  select.innerHTML = bankAccounts.map(acct => `
    <option value="${acct.id}">
      M-Pesa — ${acct.account_name} (${acct.account_number})
    </option>
  `).join('');
}

async function deleteBankAccount(id) {
  if (!confirm('Remove this bank account?')) return;
  await supabaseClient.from('bank_accounts').delete().eq('id', id);
  await loadBankAccounts();
  showToast('Bank account removed', 'info');
}

// ─── DEPOSIT ──────────────────────────────────────────────────
function openDepositModal() {
  document.getElementById('deposit-amount').value = '';
  document.getElementById('deposit-error')?.classList.add('hidden');
  openModal('deposit-modal');
}

async function initiateDeposit() {
  const amountInput = document.getElementById('deposit-amount');
  const amount = parseFloat(amountInput.value);
  const cfg = window.VERTEXT_CONFIG;

  if (!amount || amount < cfg.MIN_DEPOSIT) {
    showToast(`Minimum deposit is ${formatCurrency(cfg.MIN_DEPOSIT)}`, 'error');
    return;
  }

  const btn = document.getElementById('confirm-deposit-btn');
  setButtonLoading(btn, true);

  // ── Ensure Paystack script is loaded ──────────────────────
  if (typeof PaystackPop === 'undefined') {
    try {
      await new Promise((resolve, reject) => {
        const existing = document.querySelector('script[src*="paystack"]');
        if (existing) existing.remove();
        const script = document.createElement('script');
        script.src = 'https://js.paystack.co/v1/inline.js';
        script.onload = resolve;
        script.onerror = () => reject(new Error('Paystack script failed to load'));
        document.head.appendChild(script);
      });
    } catch (e) {
      showToast('Could not load Paystack. Check your internet connection.', 'error', 6000);
      setButtonLoading(btn, false);
      return;
    }
  }

  // Close modal, open Paystack popup
  closeModal('deposit-modal');

  const reference = generateReference();
  const amountSmallestUnit = Math.round(amount * 100); // Paystack: KES in cents

  try {
    const handler = PaystackPop.setup({
      key: cfg.PAYSTACK_PUBLIC_KEY,
      email: currentUser.email,
      amount: amountSmallestUnit,
      currency: cfg.CURRENCY,
      ref: reference,
      label: 'Vertext Pay Deposit',
      metadata: {
        user_id: currentUser.id,
        custom_fields: [
          { display_name: 'User ID', variable_name: 'user_id', value: currentUser.id }
        ]
      },
      onClose: () => {
        showToast('Payment window closed', 'info');
        setButtonLoading(btn, false);
      },
      callback: function (response) {
        verifyPayment(response.reference, btn);
      }
    });

    handler.openIframe();
  } catch (err) {
    console.error('PaystackPop error:', err);
    showToast(`Payment error: ${err.message || 'Could not open payment window'}`, 'error', 6000);
    openModal('deposit-modal'); // re-open modal so user can try again
    setButtonLoading(btn, false);
  }
}

async function verifyPayment(reference, btn) {
  showToast('Verifying payment...', 'info');
  setButtonLoading(btn, true);
  const cfg = window.VERTEXT_CONFIG;

  try {
    const { data: { session } } = await supabaseClient.auth.getSession();

    const res = await fetch(`${cfg.SUPABASE_URL}/functions/v1/verify-deposit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': cfg.SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ reference })
    });

    const result = await res.json();

    if (result.success) {
      currentBalance = result.new_balance;
      updateBalanceDisplay(currentBalance);
      showToast(`${formatCurrency(result.amount)} deposited successfully! 🎉`, 'success', 6000);
      await loadTransactions();
    } else {
      showToast(`Verification failed: ${result.error}`, 'error', 6000);
    }
  } catch (err) {
    console.error('Verify deposit error:', err);
    showToast('Payment received but verification failed. Contact support.', 'error', 8000);
  }

  setButtonLoading(btn, false);
}


// ─── WITHDRAWAL ───────────────────────────────────────────────
function openWithdrawModal() {
  if (!bankAccounts.length) {
    showToast('Please add an M-Pesa account first', 'error');
    openModal('add-bank-modal');
    return;
  }

  document.getElementById('withdraw-amount').value = '';
  updateWithdrawMax();
  openModal('withdraw-modal');
}

function updateWithdrawMax() {
  const maxEl = document.getElementById('withdraw-max');
  if (maxEl) maxEl.textContent = formatCurrency(currentBalance);
}

function setMaxWithdraw() {
  const input = document.getElementById('withdraw-amount');
  if (input) input.value = Math.floor(currentBalance * 100) / 100;
}

async function initiateWithdrawal() {
  const amount = parseFloat(document.getElementById('withdraw-amount').value);
  const bankId = document.getElementById('withdraw-bank-select').value;
  const cfg = window.VERTEXT_CONFIG;

  if (!amount || amount < cfg.MIN_WITHDRAWAL) {
    showToast(`Minimum withdrawal is ${formatCurrency(cfg.MIN_WITHDRAWAL)}`, 'error');
    return;
  }

  if (amount > currentBalance) {
    showToast(`Insufficient balance. Available: ${formatCurrency(currentBalance)}`, 'error');
    return;
  }

  if (!bankId) {
    showToast('Please select a bank account', 'error');
    return;
  }

  const btn = document.getElementById('confirm-withdraw-btn');
  setButtonLoading(btn, true);

  try {
    const { data: { session } } = await supabaseClient.auth.getSession();

    const res = await fetch(`${cfg.SUPABASE_URL}/functions/v1/initiate-withdrawal`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': cfg.SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ amount, bank_account_id: bankId })
    });

    const result = await res.json();

    if (result.success) {
      currentBalance = result.new_balance;
      updateBalanceDisplay(currentBalance);
      closeModal('withdraw-modal');
      showToast(`Withdrawal of ${formatCurrency(amount)} initiated! Funds on the way 🚀`, 'success', 6000);
      await loadTransactions();
    } else {
      showToast(`Withdrawal failed: ${result.error}`, 'error', 6000);
    }
  } catch (err) {
    showToast('Withdrawal request failed. Try again.', 'error');
    console.error('Withdrawal error:', err);
  }

  setButtonLoading(btn, false);
}

// ─── BANK ACCOUNT ─────────────────────────────────────────────
async function saveBankAccount() {
  const bankName   = document.getElementById('bank-name-input').value.trim();
  const bankCode   = document.getElementById('bank-code-input').value.trim();
  const acctNum    = document.getElementById('account-number-input').value.trim();
  const acctName   = document.getElementById('account-name-input').value.trim();

  if (!bankName || !bankCode || !acctNum || !acctName) {
    showToast('Please fill in all fields', 'error');
    return;
  }

  if (!/^\d{9,12}$/.test(acctNum)) {
    showToast('Mobile number must be between 9 and 12 digits (e.g. 0712345678)', 'error');
    return;
  }

  const btn = document.getElementById('save-bank-btn');
  setButtonLoading(btn, true);

  const { error } = await supabaseClient.from('bank_accounts').insert({
    user_id: currentUser.id,
    bank_name: bankName,
    bank_code: bankCode,
    account_number: acctNum,
    account_name: acctName,
  });

  if (error) {
    showToast('Failed to save M-Pesa account', 'error');
  } else {
    showToast('M-Pesa account saved!', 'success');
    closeModal('add-bank-modal');
    // Clear form
    ['bank-name-input','bank-code-input','account-number-input','account-name-input']
      .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    await loadBankAccounts();
  }

  setButtonLoading(btn, false);
}
