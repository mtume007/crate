from sqlalchemy import create_engine, Column, String, Integer, Float, Text, DateTime, Boolean
from sqlalchemy.orm import sessionmaker, declarative_base
from datetime import datetime
import os

DB_PATH = os.path.expanduser("~/.crate/crate.db")
os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine)
Base = declarative_base()


class Track(Base):
    __tablename__ = "tracks"

    id            = Column(Integer, primary_key=True, index=True)
    user_id       = Column(Integer, default=1)  # future-proofing for social features

    # File
    filepath      = Column(String, unique=True, nullable=False)
    filename      = Column(String)
    format        = Column(String)   # flac, mp3
    filesize      = Column(Integer)  # bytes
    duration      = Column(Float)    # seconds
    bitrate       = Column(Integer)  # kbps

    # Core metadata (from SongKong tags)
    title         = Column(String)
    artist        = Column(String)
    album_artist  = Column(String)
    album         = Column(String)
    year          = Column(String)
    genre         = Column(String)
    label         = Column(String)
    catalog_num   = Column(String)
    country       = Column(String)
    track_number  = Column(String)
    disc_number   = Column(String)
    bpm           = Column(Float)
    key           = Column(String)

    # MusicBrainz IDs (written by SongKong)
    mb_track_id   = Column(String)
    mb_album_id   = Column(String)
    mb_artist_id  = Column(String)

    # Feel tags (set by AI or user)
    feel_mood     = Column(String)   # dark, hypnotic, euphoric, melancholic, driving, dreamy
    feel_scene    = Column(String)   # warehouse, afterhours, sunset, forest, listening_bar, home
    feel_role     = Column(String)   # opener, warmup, builder, peak, transition, closer
    feel_texture  = Column(String)   # deep, acid, atmospheric, percussive, organic, industrial
    feel_energy   = Column(Integer)  # 1-10
    feel_mix_diff = Column(String)   # easy, medium, hard
    feel_tagged   = Column(Boolean, default=False)
    feel_source   = Column(String)   # ai, manual

    # Per-track notes (from listening view)
    notes         = Column(Text)

    # Artwork
    artwork_path  = Column(String)   # path to extracted artwork file

    # Timestamps
    created_at    = Column(DateTime, default=datetime.utcnow)
    updated_at    = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    scanned_at    = Column(DateTime)


class Album(Base):
    __tablename__ = "albums"

    id            = Column(Integer, primary_key=True, index=True)
    user_id       = Column(Integer, default=1)

    # Identity
    folder_path   = Column(String, unique=True, nullable=False)
    title         = Column(String)
    artist        = Column(String)
    year          = Column(String)
    label         = Column(String)
    catalog_num   = Column(String)
    genre         = Column(String)
    country       = Column(String)
    track_count   = Column(Integer, default=0)

    # MusicBrainz
    mb_album_id   = Column(String)

    # Discogs enrichment (never overwrites file tags)
    enriched_label       = Column(String)
    enriched_catalog_num = Column(String)
    enriched_genre       = Column(String)
    enriched_year        = Column(String)
    enriched_country     = Column(String)
    enriched_style       = Column(String)
    enriched_format      = Column(String)
    enriched_discogs_id  = Column(String)
    enriched_discogs_url = Column(String)
    enriched_source      = Column(String, default='file')  # 'file' | 'discogs'

    # AI shelf classification (set by classify-shelf pass, never overwritten by Discogs)
    shelf_key            = Column(String)   # e.g. "Atmospheric Drum n Bass", "Tech House"

    # Artwork
    artwork_path  = Column(String)

    # Timestamps
    created_at    = Column(DateTime, default=datetime.utcnow)
    updated_at    = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


def init_db():
    Base.metadata.create_all(bind=engine)
    _migrate_enriched_columns()

def _migrate_enriched_columns():
    """Add enriched_* columns to existing databases that predate this migration."""
    from sqlalchemy import text
    enriched_cols = [
        'enriched_label', 'enriched_catalog_num', 'enriched_genre',
        'enriched_year', 'enriched_country', 'enriched_style',
        'enriched_format', 'enriched_discogs_id', 'enriched_discogs_url',
        'enriched_source', 'shelf_key',
    ]
    with engine.connect() as conn:
        for col in enriched_cols:
            try:
                conn.execute(text(f'ALTER TABLE albums ADD COLUMN {col} TEXT'))
                conn.commit()
            except Exception:
                pass  # Column already exists


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
