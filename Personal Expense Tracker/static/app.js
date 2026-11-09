const STORAGE_KEY = "pennywise.transactions.v1";
const BUDGET_KEY = "pennywise.monthlyBudget.v1";
const CATEGORIES = ["Food", "Transport", "Housing", "Shopping", "Health", "Utilities", "Salary", "Other"];
const CATEGORY_ICONS = {
  Food: "◉",
  Transport: "↗",
  Housing: "⌂",
  Shopping: "◇",
  Health: "✚",
  Utilities: "ϟ",
  Salary: "↙",
  Other: "·",
};

const $ = (selector) => document.querySelector(selector);
const currency = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });
const today = new Date();
const monthPicker = $("#monthPicker");
const transactionDialog = $("#transactionDialog");
const transactionForm = $("#transactionForm");
let transactions = [];
let monthlyBudget = 2000;
let editingId = null;

monthPicker.value = monthKey(today);
$("#todayLabel").textContent = today.toLocaleDateString("en-US", { month: "long", year: "numeric" }).toUpperCase();
populateCategoryOptions();
startApp();

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function localDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function readLocalTransactions() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return [];
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error("Could not read older browser transactions.", error);
    return [];
  }
}

function readLocalBudget() {
  const parsed = Number(localStorage.getItem(BUDGET_KEY));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 2000;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "The server could not save that change.");
  }
  if (response.status === 204) return null;
  return response.json();
}

async function startApp() {
  try {
    const localTransactions = readLocalTransactions();
    const state = localTransactions.length
      ? await api("/api/transactions/import", {
          method: "POST",
          body: JSON.stringify({ transactions: localTransactions, budget: readLocalBudget() }),
        })
      : await api("/api/state");
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(BUDGET_KEY);
    transactions = state.transactions;
    monthlyBudget = state.budget;
  } catch (error) {
    console.error("Could not load transactions from the server.", error);
    window.alert("Pennywise could not reach the Flask server. Refresh the page and try again.");
  }
  $("#budgetInput").value = monthlyBudget;
  render();
}

function populateCategoryOptions() {
  const filter = $("#categoryFilter");
  const formSelect = $("#formCategory");
  for (const category of CATEGORIES) {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    filter.append(option);

    const formOption = option.cloneNode(true);
    formSelect.append(formOption);
  }
}

function formatCurrency(value) {
  return currency.format(value);
}

function getVisibleMonthTransactions() {
  const selectedMonth = monthPicker.value;
  return transactions.filter((transaction) => transaction.date.startsWith(selectedMonth));
}

function render() {
  const monthTransactions = getVisibleMonthTransactions();
  const income = monthTransactions.reduce((sum, item) => sum + (item.type === "income" ? item.amount : 0), 0);
  const expenses = monthTransactions.reduce((sum, item) => sum + (item.type === "expense" ? item.amount : 0), 0);

  $("#balanceMetric").textContent = formatCurrency(income - expenses);
  $("#incomeMetric").textContent = formatCurrency(income);
  $("#expenseMetric").textContent = formatCurrency(expenses);
  $("#chartTotal").textContent = formatCurrency(expenses);
  $("#chartPeriod").textContent = monthPicker.value === monthKey(today)
    ? "This month"
    : new Date(`${monthPicker.value}-01T12:00:00`).toLocaleDateString("en-US", { month: "short", year: "numeric" });

  renderChart(monthTransactions);
  renderBudget(expenses);
  renderTransactions(monthTransactions);
}

function renderChart(monthTransactions) {
  const totals = [0, 0, 0, 0, 0];
  const currentWeek = monthPicker.value === monthKey(today)
    ? Math.min(4, Math.floor((today.getDate() - 1) / 7))
    : -1;
  for (const transaction of monthTransactions) {
    if (transaction.type !== "expense") continue;
    const day = Number(transaction.date.slice(-2));
    const weekIndex = Math.min(4, Math.floor((day - 1) / 7));
    totals[weekIndex] += transaction.amount;
  }

  const maxTotal = Math.max(...totals, 1);
  const chart = $("#spendingChart");
  chart.replaceChildren();
  chart.setAttribute("aria-label", `Weekly expenses for ${$("#chartPeriod").textContent}: ${totals.map((value, index) => `week ${index + 1}, ${formatCurrency(value)}`).join("; ")}`);

  totals.forEach((value, index) => {
    const column = document.createElement("div");
    column.className = `chart-column${index === currentWeek ? " current" : ""}`;
    const barSpace = document.createElement("div");
    barSpace.className = "bar-space";
    const bar = document.createElement("div");
    bar.className = "chart-bar";
    bar.style.height = `${value === 0 ? 3 : Math.max(8, (value / maxTotal) * 70)}px`;
    bar.title = formatCurrency(value);
    barSpace.append(bar);
    const label = document.createElement("span");
    label.className = "chart-label";
    label.textContent = `Week ${index + 1}`;
    column.append(barSpace, label);
    chart.append(column);
  });
}

function renderBudget(expenses) {
  const isOverBudget = expenses > monthlyBudget;
  const percent = monthlyBudget === 0
    ? (expenses > 0 ? 100 : 0)
    : (expenses / monthlyBudget) * 100;
  const visualPercent = Math.min(percent, 100);
  const remaining = monthlyBudget - expenses;
  const progress = $("#budgetProgress");
  progress.style.width = `${visualPercent}%`;
  progress.classList.toggle("over-budget", isOverBudget);
  $(".progress-track").setAttribute("aria-valuenow", String(Math.round(visualPercent)));
  $("#budgetSpent").textContent = formatCurrency(expenses);
  $("#budgetPercent").textContent = `${Math.round(percent)}% used`;
  $("#budgetRemaining").textContent = `${formatCurrency(Math.abs(remaining))} ${remaining < 0 ? "over budget" : "left"}`;
  $("#budgetHint").textContent = isOverBudget
    ? "You’re over budget. Review your transactions to see where you can adjust."
    : percent >= 80
      ? "You’re getting close to your budget limit. Keep an eye on spending."
      : "You’re off to a good start. Keep it up!";
}

function renderTransactions(monthTransactions) {
  const query = $("#searchInput").value.trim().toLowerCase();
  const category = $("#categoryFilter").value;
  const filtered = monthTransactions
    .filter((item) => category === "all" || item.category === category)
    .filter((item) => !query || `${item.description} ${item.category} ${item.type}`.toLowerCase().includes(query))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));

  const rows = $("#transactionRows");
  rows.replaceChildren();
  for (const item of filtered) rows.append(createTransactionRow(item));
  $("#emptyState").hidden = filtered.length !== 0;
  $("#transactionCount").textContent = `Showing ${filtered.length} transaction${filtered.length === 1 ? "" : "s"}`;
}

function createTransactionRow(item) {
  const row = document.createElement("tr");
  const transactionCell = document.createElement("td");
  const nameWrap = document.createElement("div");
  nameWrap.className = "transaction-name";
  const icon = document.createElement("span");
  icon.className = `transaction-icon ${(item.category || "Other").toLowerCase()}`;
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = CATEGORY_ICONS[item.category] || CATEGORY_ICONS.Other;
  const textWrap = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = item.description;
  const subtitle = document.createElement("small");
  subtitle.textContent = item.type === "income" ? "Income" : "Expense";
  textWrap.append(title, subtitle);
  nameWrap.append(icon, textWrap);
  transactionCell.append(nameWrap);

  const categoryCell = document.createElement("td");
  const categoryTag = document.createElement("span");
  categoryTag.className = "category-tag";
  categoryTag.textContent = item.category;
  categoryCell.append(categoryTag);

  const dateCell = document.createElement("td");
  dateCell.textContent = new Date(`${item.date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const amountCell = document.createElement("td");
  amountCell.className = `amount-cell${item.type === "income" ? " income" : ""}`;
  amountCell.textContent = `${item.type === "income" ? "+" : "−"}${formatCurrency(item.amount)}`;
  const actionsCell = document.createElement("td");
  actionsCell.className = "row-actions";
  const editButton = document.createElement("button");
  editButton.className = "icon-button row-action-button";
  editButton.type = "button";
  editButton.setAttribute("aria-label", `Edit ${item.description}`);
  editButton.textContent = "✎";
  editButton.addEventListener("click", () => openEditDialog(item));
  const deleteButton = document.createElement("button");
  deleteButton.className = "icon-button row-action-button";
  deleteButton.type = "button";
  deleteButton.setAttribute("aria-label", `Delete ${item.description}`);
  deleteButton.textContent = "×";
  deleteButton.addEventListener("click", () => deleteTransaction(item.id));
  actionsCell.append(editButton, deleteButton);
  row.append(transactionCell, categoryCell, dateCell, amountCell, actionsCell);
  return row;
}

function openDialog() {
  editingId = null;
  transactionForm.reset();
  transactionForm.elements.date.value = localDateString(today);
  $("#dialogTitle").textContent = "Add transaction";
  transactionDialog.showModal();
  transactionForm.elements.description.focus();
}

function openEditDialog(item) {
  editingId = item.id;
  transactionForm.elements.description.value = item.description;
  transactionForm.elements.amount.value = item.amount;
  transactionForm.elements.type.value = item.type;
  transactionForm.elements.category.value = item.category;
  transactionForm.elements.date.value = item.date;
  $("#dialogTitle").textContent = "Edit transaction";
  transactionDialog.showModal();
  transactionForm.elements.description.focus();
}

async function deleteTransaction(id) {
  const transaction = transactions.find((item) => item.id === id);
  if (!transaction || !window.confirm(`Delete "${transaction.description}"?`)) return;
  try {
    await api(`/api/transactions/${id}`, { method: "DELETE" });
    transactions = transactions.filter((item) => item.id !== id);
    render();
  } catch (error) {
    console.error("Could not delete the transaction.", error);
    window.alert(error.message);
  }
}

$("#addTransactionButton").addEventListener("click", openDialog);
$("#closeDialogButton").addEventListener("click", () => transactionDialog.close());
$("#cancelDialogButton").addEventListener("click", () => transactionDialog.close());
$("#searchInput").addEventListener("input", render);
$("#categoryFilter").addEventListener("change", render);
monthPicker.addEventListener("change", render);
$("#clearFilters").addEventListener("click", (event) => {
  event.preventDefault();
  $("#searchInput").value = "";
  $("#categoryFilter").value = "all";
  render();
});

$("#budgetInput").addEventListener("change", async (event) => {
  const value = Number(event.currentTarget.value);
  if (!Number.isFinite(value) || value < 0) {
    event.currentTarget.value = monthlyBudget;
    return;
  }
  try {
    const saved = await api("/api/budget", {
      method: "PUT",
      body: JSON.stringify({ amount: value }),
    });
    monthlyBudget = saved.budget;
    event.currentTarget.value = monthlyBudget;
    render();
  } catch (error) {
    console.error("Could not save the budget.", error);
    event.currentTarget.value = monthlyBudget;
    window.alert(error.message);
  }
});

transactionForm.elements.type.addEventListener("change", (event) => {
  const categorySelect = transactionForm.elements.category;
  if (event.currentTarget.value === "income") {
    categorySelect.value = "Salary";
  } else if (categorySelect.value === "Salary") {
    categorySelect.value = "Food";
  }
});

transactionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!transactionForm.reportValidity()) return;

  const formData = new FormData(transactionForm);
  const amount = Number(formData.get("amount"));
  if (!Number.isFinite(amount) || amount <= 0) return;

  const item = {
    description: String(formData.get("description")).trim(),
    amount,
    type: String(formData.get("type")),
    category: String(formData.get("category")),
    date: String(formData.get("date")),
  };
  if (!item.description || !/^\d{4}-\d{2}-\d{2}$/.test(item.date)) return;

  try {
    const saved = await api(editingId ? `/api/transactions/${editingId}` : "/api/transactions", {
      method: editingId ? "PUT" : "POST",
      body: JSON.stringify(item),
    });
    if (editingId) {
      transactions = transactions.map((existing) => existing.id === editingId ? saved : existing);
    } else {
      transactions.push(saved);
    }
    transactionDialog.close();
    render();
  } catch (error) {
    console.error("Could not save the transaction.", error);
    window.alert(error.message);
  }
});

$("#exportButton").addEventListener("click", () => {
  const rows = getVisibleMonthTransactions();
  const csv = [
    ["Description", "Type", "Category", "Date", "Amount"],
    ...rows.map((item) => [item.description, item.type, item.category, item.date, item.amount.toFixed(2)]),
  ].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `pennywise-${monthPicker.value}.csv`;
  link.click();
  URL.revokeObjectURL(url);
});
