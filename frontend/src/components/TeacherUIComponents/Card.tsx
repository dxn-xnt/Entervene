type CardProps = {
    title: string;
    count: string;
    stat: string;
};

const Card = ({ title, count, stat }: CardProps) => {
    return (
        <div className="border rounded-lg p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
            <h2 className="text-2xl font-semibold truncate">{title}</h2>
            <p className="text-3xl">{count}</p>
            <p className="text-sm">{stat}</p>
        </div>
    )
}

export default Card;