from datetime import date, datetime, timedelta, timezone
import os

from flask import Flask, jsonify, redirect, render_template, render_template_string, request, url_for
from flask_login import LoginManager, UserMixin, current_user, login_required, login_user, logout_user
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy.exc import IntegrityError
from werkzeug.security import check_password_hash, generate_password_hash

app = Flask(__name__)
app.config["SECRET_KEY"] = "expense_tracker_secret_key_2026"
app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///expense.db"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

db = SQLAlchemy(app)
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = "login"

CATEGORIES = [
    "Food",
    "Transport",
    "Housing",
    "Shopping",
    "Health",
    "Salary",
    "Other",
]
TRANSACTION_TYPES = {"expense", "income"}
DEFAULT_BUDGET = 2000.0
DEFAULT_EMAIL = "chandana@pennywise.local"

SAMPLE_TRANSACTIONS = [
    (0, "Weekly groceries", "Food", 86.4, "expense"),
    (1, "Monthly salary", "Salary", 4200, "income"),
    (3, "Coffee & lunch", "Food", 24.75, "expense"),
    (5, "Metro card", "Transport", 32, "expense"),
    (8, "Electric bill", "Utilities", 68.2, "expense"),
    (11, "New notebook", "Shopping", 18.5, "expense"),
    (14, "Pharmacy", "Health", 27.99, "expense"),
    (18, "Rent", "Housing", 1450, "expense"),
]


class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(100), nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password = db.Column(db.String(255), nullable=False)
    transactions = db.relationship(
        "Transaction",
        backref="user",
        lazy=True,
        cascade="all, delete-orphan",
    )
    budget = db.relationship(
        "Budget",
        backref="user",
        uselist=False,
        cascade="all, delete-orphan",
    )


class Budget(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), unique=True, nullable=False)
    amount = db.Column(db.Float, nullable=False, default=DEFAULT_BUDGET)


class Transaction(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    title = db.Column(db.String(150), nullable=False)
    amount = db.Column(db.Float, nullable=False)
    category = db.Column(db.String(100), nullable=False)
    type = db.Column(db.String(20), nullable=False)
    date = db.Column(db.Date, nullable=False, default=date.today)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))


@login_manager.user_loader
def load_user(user_id):
    return db.session.get(User, int(user_id))


def ensure_account():
    user = User.query.filter_by(email=DEFAULT_EMAIL).first()
    if user is None:
        user = User(
            username="Chandana",
            email=DEFAULT_EMAIL,
            password=generate_password_hash("local-only"),
        )
        db.session.add(user)
        db.session.flush()
    elif not user.password:
        user.password = generate_password_hash("local-only")
        db.session.add(user)

    if user.budget is None:
        db.session.add(Budget(user_id=user.id, amount=DEFAULT_BUDGET))
        db.session.flush()
    return user

def transaction_to_dict(item):
    return {
        "id": str(item.id),
        "description": item.title,
        "amount": item.amount,
        "category": item.category,
        "type": item.type,
        "date": item.date.isoformat(),
    }


def state_payload(user):
    transactions = (
        Transaction.query.filter_by(user_id=user.id)
        .order_by(Transaction.date.desc(), Transaction.id.desc())
        .all()
    )
    return {
        "transactions": [transaction_to_dict(item) for item in transactions],
        "budget": user.budget.amount,
    }


def parse_amount(value):
    try:
        amount = float(value)
    except (TypeError, ValueError):
        return None
    if amount != amount or amount <= 0 or amount > 100000000:
        return None
    return round(amount, 2)


def parse_budget(value):
    try:
        amount = float(value)
    except (TypeError, ValueError):
        return None
    if amount != amount or amount < 0 or amount > 100000000:
        return None
    return round(amount, 2)


def parse_transaction(payload):
    if not isinstance(payload, dict):
        return None, "Transaction details are missing."

    description = str(payload.get("description", "")).strip()
    if not description or len(description) > 60:
        return None, "Enter a description of 60 characters or fewer."

    amount = parse_amount(payload.get("amount"))
    if amount is None:
        return None, "Enter an amount greater than zero."

    category = str(payload.get("category", "")).strip()
    if category not in CATEGORIES:
        return None, "Choose a valid category."

    transaction_type = str(payload.get("type", "")).strip()
    if transaction_type not in TRANSACTION_TYPES:
        return None, "Choose income or expense."

    try:
        transaction_date = date.fromisoformat(str(payload.get("date", "")))
    except ValueError:
        return None, "Choose a valid date."

    return {
        "title": description,
        "amount": amount,
        "category": category,
        "type": transaction_type,
        "date": transaction_date,
    }, None


def add_transaction(user, fields):
    item = Transaction(user_id=user.id, **fields)
    db.session.add(item)
    return item


def seed_sample_transactions(user):
    today = date.today()
    for days_ago, title, category, amount, transaction_type in SAMPLE_TRANSACTIONS:
        db.session.add(
            Transaction(
                user_id=user.id,
                title=title,
                category=category,
                amount=amount,
                type=transaction_type,
                date=today - timedelta(days=days_ago),
            )
        )


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        email = str(request.form.get("email", "")).strip().lower()
        password = str(request.form.get("password", ""))
        user = User.query.filter_by(email=email).first()
        if user and check_password_hash(user.password, password):
            login_user(user, remember=request.form.get("remember_me") == "on")
            next_page = request.args.get("next") or url_for("home")
            return redirect(next_page)
        return render_template("login.html", mode="login", error="Invalid email or password.", email=email)

    if current_user.is_authenticated:
        return redirect(url_for("home"))
    return render_template("login.html", mode="login", error=None, email="")


@app.route("/register", methods=["GET", "POST"])
def register():
    if current_user.is_authenticated:
        return redirect(url_for("home"))

    if request.method == "POST":
        email = str(request.form.get("email", "")).strip().lower()
        password = str(request.form.get("password", ""))
        confirmation = str(request.form.get("confirm_password", ""))

        if len(email) > 120 or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
            error = "Enter a valid email address."
        elif len(password) < 8:
            error = "Your password must be at least 8 characters."
        elif len(password) > 128:
            error = "Your password must be 128 characters or fewer."
        elif password != confirmation:
            error = "The passwords do not match."
        elif User.query.filter_by(email=email).first():
            error = "An account with that email already exists. Please log in."
        else:
            user = User(
                username=email.partition("@")[0][:100],
                email=email,
                password=generate_password_hash(password),
            )
            db.session.add(user)
            try:
                db.session.flush()
                db.session.add(Budget(user_id=user.id, amount=DEFAULT_BUDGET))
                db.session.commit()
            except IntegrityError:
                db.session.rollback()
                return render_template(
                    "login.html",
                    mode="register",
                    error="An account with that email already exists. Please log in.",
                    email=email,
                )

            login_user(user)
            return redirect(url_for("home"))

        return render_template("login.html", mode="register", error=error, email=email)

    return render_template("login.html", mode="register", error=None, email="")


@app.route("/logout")
def logout():
    logout_user()
    return redirect(url_for("login"))


@app.route("/")
@login_required
def home():
    return render_template("index.html", username=current_user.username)


@app.get("/api/state")
@login_required
def api_state():
    user = current_user
    db.session.commit()
    return jsonify(state_payload(user))


@app.post("/api/transactions")
@login_required
def create_transaction():
    fields, error = parse_transaction(request.get_json(silent=True) or {})
    if error:
        return jsonify({"error": error}), 400

    user = current_user
    item = add_transaction(user, fields)
    db.session.commit()
    return jsonify(transaction_to_dict(item)), 201


@app.put("/api/transactions/<int:transaction_id>")
@login_required
def update_transaction(transaction_id):
    fields, error = parse_transaction(request.get_json(silent=True) or {})
    if error:
        return jsonify({"error": error}), 400

    user = current_user
    item = Transaction.query.filter_by(id=transaction_id, user_id=user.id).first()
    if item is None:
        return jsonify({"error": "Transaction not found."}), 404

    item.title = fields["title"]
    item.amount = fields["amount"]
    item.category = fields["category"]
    item.type = fields["type"]
    item.date = fields["date"]
    db.session.commit()
    return jsonify(transaction_to_dict(item))


@app.delete("/api/transactions/<int:transaction_id>")
@login_required
def delete_transaction(transaction_id):
    user = current_user
    item = Transaction.query.filter_by(id=transaction_id, user_id=user.id).first()
    if item is None:
        return jsonify({"error": "Transaction not found."}), 404

    db.session.delete(item)
    db.session.commit()
    return ("", 204)


@app.put("/api/budget")
@login_required
def update_budget():
    amount = parse_budget((request.get_json(silent=True) or {}).get("amount"))
    if amount is None:
        return jsonify({"error": "Enter a budget of zero or more."}), 400

    user = current_user
    user.budget.amount = amount
    db.session.commit()
    return jsonify({"budget": amount})


@app.post("/api/transactions/import")
@login_required
def import_transactions():
    """Move an older browser-only copy into SQLite when the account is still empty."""
    payload = request.get_json(silent=True) or {}
    incoming = payload.get("transactions")
    if not isinstance(incoming, list):
        return jsonify({"error": "Transactions must be a list."}), 400

    user = current_user
    if Transaction.query.filter_by(user_id=user.id).count() == 0:
        for raw in incoming:
            fields, error = parse_transaction(raw)
            if error:
                db.session.rollback()
                return jsonify({"error": error}), 400
            add_transaction(user, fields)

        if "budget" in payload:
            amount = parse_budget(payload.get("budget"))
            if amount is None:
                db.session.rollback()
                return jsonify({"error": "Enter a budget of zero or more."}), 400
            user.budget.amount = amount

    db.session.commit()
    return jsonify(state_payload(user))


@app.route("/test-db")
def test_db():
    try:
        return (
            "<h1>Database Connected Successfully!</h1>"
            f"<h3>Total Users: {User.query.count()}</h3>"
            f"<h3>Total Transactions: {Transaction.query.count()}</h3>"
        )
    except Exception as error:
        return f"Database Error: {error}", 500


with app.app_context():
    db.create_all()


if __name__ == "__main__":
    app.run(debug=True)
